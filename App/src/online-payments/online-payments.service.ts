import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, GatewayOrder, GatewayOrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../mail/secret-box';
import { PaymentsService } from '../payments/payments.service';
import { maxPayment, outstandingForFlat } from '../payments/settlement';
import { DEFAULT_PUBLIC_API_URL } from '../receipts/receipt-link';
import {
  KEY_ID_PATTERN, LinkCallback, RazorpayCreds, RazorpayError, callbackIsSigned, checkKeys, createPaymentLink, fetchPaymentLink, fromPaise, modeOf, toPaise,
} from './razorpay';

const MINUTE_MS = 60_000;
/** A Payment Link stays open this long; Razorpay's own minimum is 15 minutes. */
const LINK_LIFE_MS = 60 * MINUTE_MS;
/** An order nobody finished is given up on after this. */
const ORDER_LIFE_MS = 3 * 24 * 60 * MINUTE_MS;
/** A person cannot pile up unfinished payments. */
const MAX_OPEN_PER_USER = 5;

export interface GatewayView {
  /** Keys are saved. */
  connected: boolean;
  /** Residents are offered "Pay online". */
  enabled: boolean;
  provider: 'RAZORPAY';
  keyId: string | null;
  /** TEST moves no money; LIVE is real. */
  mode: 'TEST' | 'LIVE' | null;
  settlementAccount: { id: string; name: string } | null;
  /** Why it is connected but cannot take payments, in words; null when all is well. */
  problem: string | null;
}

export interface SaveGatewayInput {
  keyId: string;
  /** Blank keeps the saved secret; required the first time and whenever the Key ID changes. */
  keySecret?: string | null;
  settlementAccountId: string;
  enabled?: boolean;
}

export type OrderOutcome = 'WAITING' | 'PAID' | 'NEEDS_REVIEW' | 'EXPIRED' | 'FAILED';

export interface OrderView {
  id: string;
  outcome: OrderOutcome;
  amount: string;
  paidAt: Date | null;
  /** The page to pay on, while it is still open. */
  url: string | null;
}

const outcomeOf = (o: Pick<GatewayOrder, 'status' | 'paymentSubmissionId'>, applied: boolean): OrderOutcome => {
  // Paid at Razorpay but not yet in the books is a moment in between, not a problem for a person: it reads as still confirming.
  if (o.status === GatewayOrderStatus.PAID) return !o.paymentSubmissionId ? 'WAITING' : applied ? 'PAID' : 'NEEDS_REVIEW';
  if (o.status === GatewayOrderStatus.EXPIRED) return 'EXPIRED';
  if (o.status === GatewayOrderStatus.FAILED) return 'FAILED';
  return 'WAITING';
};

/**
 * Online payments through a society's OWN Razorpay account. Nothing here belongs to NG Home: the keys are the society's,
 * stored encrypted; the money goes from the resident to the society's Razorpay account and on to its bank; NG Home only
 * asks Razorpay to make a payment page for one bill and asks it afterwards whether that page was paid.
 *
 * "Paid" is never taken from the resident's phone or from a page address: it is read from Razorpay with the society's own
 * keys. The return page, a status check from the app and a background pass all do the same read, and a payment can only be
 * applied once however many of them arrive.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
  ) {}

  private get secret(): string {
    return this.config.get<string>('settingsEncryptionKey') || this.config.get<string>('jwt.accessSecret') || 'default-access-secret';
  }

  private get publicApi(): string {
    return (process.env.PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL).replace(/\/+$/, '');
  }

  /** The society's keys, or null when none are saved or the secret can no longer be read. */
  private async creds(societyId: string): Promise<(RazorpayCreds & { settlementAccountId: string; enabled: boolean }) | null> {
    const row = await this.prisma.societyPaymentGateway.findUnique({ where: { societyId } });
    if (!row) return null;
    const keySecret = decryptSecret(row.keySecretEnc, this.secret);
    if (keySecret === null) {
      this.logger.error(`The Razorpay secret saved for society ${societyId} cannot be decrypted — SETTINGS_ENCRYPTION_KEY (or JWT_ACCESS_SECRET) has changed since it was saved. Its admin must enter it again.`);
      return null;
    }
    return { keyId: row.keyId, keySecret, settlementAccountId: row.settlementAccountId, enabled: row.enabled };
  }

  // ── admin: connect the society's own account ─────────────────────────────────────────────────────────────────────────

  async view(societyId: string): Promise<GatewayView> {
    const row = await this.prisma.societyPaymentGateway.findUnique({ where: { societyId } });
    if (!row) return { connected: false, enabled: false, provider: 'RAZORPAY', keyId: null, mode: null, settlementAccount: null, problem: null };
    const account = await this.prisma.account.findFirst({ where: { id: row.settlementAccountId, societyId }, select: { id: true, name: true, isActive: true } });
    let problem: string | null = null;
    if (decryptSecret(row.keySecretEnc, this.secret) === null) problem = 'The saved Key Secret can no longer be read. Enter it again.';
    else if (!account || !account.isActive) problem = 'The account that online payments are credited to is missing or closed. Choose another.';
    return {
      connected: true,
      enabled: row.enabled,
      provider: 'RAZORPAY',
      keyId: row.keyId,
      mode: modeOf(row.keyId),
      settlementAccount: account ? { id: account.id, name: account.name } : null,
      problem,
    };
  }

  /** Whether residents are offered "Pay online": switched on, keys readable, and an open account to credit. */
  async available(societyId: string): Promise<{ enabled: boolean }> {
    const view = await this.view(societyId);
    return { enabled: view.connected && view.enabled && view.problem === null };
  }

  /**
   * Save the society's Razorpay keys after checking them with Razorpay, so a wrong key is refused in Razorpay's own words
   * instead of being saved and failing every payment later. The secret is stored encrypted and never sent back.
   */
  async save(societyId: string, input: SaveGatewayInput, actorId: string): Promise<GatewayView> {
    const keyId = input.keyId.trim();
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new BadRequestException('The Key ID looks like rzp_live_… or rzp_test_…, as shown in your Razorpay dashboard under Account & Settings → API Keys.');
    }
    const existing = await this.prisma.societyPaymentGateway.findUnique({ where: { societyId } });
    const typed = input.keySecret && input.keySecret.trim().length > 0 ? input.keySecret.trim() : null;
    // A secret belongs to one Key ID: a different Key ID is a different account, so the old secret cannot be kept for it.
    if (!typed && (!existing || existing.keyId !== keyId)) throw new BadRequestException('Enter the Key Secret from your Razorpay dashboard.');
    if (typed && (typed.length < 10 || typed.length > 100)) throw new BadRequestException('That Key Secret does not look right. Copy it again from your Razorpay dashboard.');

    const account = await this.prisma.account.findFirst({ where: { id: input.settlementAccountId, societyId, isActive: true }, select: { id: true } });
    if (!account) throw new BadRequestException('Choose the society account that online payments are credited to.');

    const keySecret = typed ?? (existing ? decryptSecret(existing.keySecretEnc, this.secret) : null);
    if (!keySecret) throw new BadRequestException('Enter the Key Secret from your Razorpay dashboard.');
    try {
      await checkKeys({ keyId, keySecret });
    } catch (err) {
      throw new BadRequestException(err instanceof RazorpayError ? err.message : 'Razorpay could not be checked.');
    }

    const enabled = input.enabled ?? existing?.enabled ?? false;
    const data = { keyId, settlementAccountId: account.id, enabled, updatedById: actorId, ...(typed ? { keySecretEnc: encryptSecret(typed, this.secret) } : {}) };
    if (existing) await this.prisma.societyPaymentGateway.update({ where: { societyId }, data });
    else await this.prisma.societyPaymentGateway.create({ data: { societyId, ...data, keySecretEnc: encryptSecret(keySecret, this.secret) } });

    await this.audit(societyId, actorId, existing ? { keyId: existing.keyId, enabled: existing.enabled } : null, { keyId, mode: modeOf(keyId), enabled, secretReplaced: !!typed });
    return this.view(societyId);
  }

  /** Forget the keys. Payments already made and recorded are untouched; unfinished ones can no longer be confirmed. */
  async disconnect(societyId: string, actorId: string): Promise<GatewayView> {
    const existing = await this.prisma.societyPaymentGateway.findUnique({ where: { societyId } });
    if (existing) {
      await this.prisma.societyPaymentGateway.delete({ where: { societyId } });
      await this.audit(societyId, actorId, { keyId: existing.keyId, enabled: existing.enabled }, { disconnected: true });
    }
    return this.view(societyId);
  }

  private async audit(societyId: string, actorId: string, oldValues: Record<string, unknown> | null, newValues: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: {
        societyId,
        actorId,
        action: AuditAction.CONFIG_CHANGED,
        entityType: 'SocietyPaymentGateway',
        entityId: societyId,
        oldValues: oldValues ? (oldValues as Prisma.InputJsonValue) : Prisma.JsonNull,
        // Never the secret — only that it was replaced.
        newValues: newValues as Prisma.InputJsonValue,
      },
    });
  }

  /** The last payments started from the app, for the admin to see how it is going. */
  async recent(societyId: string, take = 15) {
    const orders = await this.prisma.gatewayOrder.findMany({ where: { societyId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(take, 1), 50) });
    const flats = await this.prisma.flat.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.flatId))] } }, select: { id: true, flatCode: true } });
    const code = new Map(flats.map((f) => [f.id, f.flatCode]));
    const payments = await this.prisma.paymentSubmission.findMany({ where: { id: { in: orders.flatMap((o) => (o.paymentSubmissionId ? [o.paymentSubmissionId] : [])) } }, select: { id: true, status: true } });
    const applied = new Map(payments.map((p) => [p.id, p.status === PaymentStatus.APPROVED]));
    return orders.map((o) => ({
      id: o.id,
      flatCode: code.get(o.flatId) ?? null,
      amount: o.amount.toString(),
      outcome: outcomeOf(o, o.paymentSubmissionId ? applied.get(o.paymentSubmissionId) === true : false),
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      reason: o.failureReason,
    }));
  }

  // ── resident: pay a bill ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Start a payment for one of the caller's own bills. Returns the Razorpay page to open. */
  async start(societyId: string, userId: string, input: { maintenanceBillId: string; amount: number | string }): Promise<OrderView> {
    const gateway = await this.creds(societyId);
    if (!gateway || !gateway.enabled) throw new BadRequestException('Paying online is not switched on for your society.');
    const account = await this.prisma.account.findFirst({ where: { id: gateway.settlementAccountId, societyId, isActive: true }, select: { id: true } });
    if (!account) throw new BadRequestException('Paying online is not set up properly for your society yet. Ask the admin.');

    const bill = await this.prisma.maintenanceBill.findFirst({ where: { id: input.maintenanceBillId, societyId } });
    if (!bill) throw new NotFoundException('Bill not found');
    const membership = await this.prisma.societyMembership.findFirst({ where: { societyId, userId, flatId: bill.flatId, status: 'ACTIVE' }, select: { id: true } });
    if (!membership) throw new ForbiddenException('That bill is not for your flat.');
    if (!bill.isPublished) throw new BadRequestException('That bill has not been published yet.');

    let amountPaise: number;
    try {
      amountPaise = toPaise(input.amount);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Enter a valid amount.');
    }
    const amount = new Prisma.Decimal(fromPaise(amountPaise));
    const ceiling = maxPayment(await outstandingForFlat(this.prisma, societyId, bill.flatId), bill.totalAmount);
    if (amount.greaterThan(ceiling)) {
      throw new BadRequestException(`That is more than this flat can pay at once (₹${ceiling.toString()}: what it owes plus a year ahead). Check the amount.`);
    }

    const open = await this.prisma.gatewayOrder.count({ where: { societyId, userId, status: GatewayOrderStatus.CREATED, createdAt: { gt: new Date(Date.now() - LINK_LIFE_MS) } } });
    if (open >= MAX_OPEN_PER_USER) throw new BadRequestException('You already have several payments waiting. Finish one of them, or try again in a little while.');

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, phone: true } });
    const phone = (user?.phone ?? '').replace(/\D/g, '').slice(-10);
    const order = await this.prisma.gatewayOrder.create({ data: { societyId, flatId: bill.flatId, userId, maintenanceBillId: bill.id, amount } });

    try {
      const link = await createPaymentLink(gateway, {
        amountPaise,
        referenceId: order.id,
        description: `Maintenance — invoice ${bill.invoiceNumber}`,
        customerName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
        customerPhone: /^[6-9]\d{9}$/.test(phone) ? phone : undefined,
        callbackUrl: `${this.publicApi}/api/v1/public/online-payments/return`,
        expireBy: Math.floor((Date.now() + LINK_LIFE_MS) / 1000),
      });
      const saved = await this.prisma.gatewayOrder.update({ where: { id: order.id }, data: { providerLinkId: link.id } });
      return { id: saved.id, outcome: 'WAITING', amount: amount.toString(), paidAt: null, url: link.url };
    } catch (err) {
      const reason = err instanceof RazorpayError ? err.message : 'The payment could not be started.';
      await this.prisma.gatewayOrder.update({ where: { id: order.id }, data: { status: GatewayOrderStatus.FAILED, failureReason: reason } });
      throw new BadRequestException(`Razorpay could not start this payment: ${reason}`);
    }
  }

  /** Where a payment stands. Reads Razorpay first if it is still open, so the answer is the real one. */
  async statusOf(societyId: string, userId: string, orderId: string): Promise<OrderView> {
    const order = await this.prisma.gatewayOrder.findFirst({ where: { id: orderId, societyId, userId } });
    if (!order) throw new NotFoundException('Payment not found');
    const current = await this.confirm(order);
    return this.view1(current);
  }

  private async view1(order: GatewayOrder): Promise<OrderView> {
    let applied = false;
    if (order.paymentSubmissionId) {
      const p = await this.prisma.paymentSubmission.findUnique({ where: { id: order.paymentSubmissionId }, select: { status: true } });
      applied = p?.status === PaymentStatus.APPROVED;
    }
    return { id: order.id, outcome: outcomeOf(order, applied), amount: order.amount.toString(), paidAt: order.paidAt, url: null };
  }

  // ── the one place "paid" is decided ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Ask Razorpay about this order (with the society's own keys) and act on the answer: paid, apply it once; expired or
   * cancelled, give it up. Safe to call at any time and any number of times; an order already settled returns as it is.
   */
  async confirm(order: GatewayOrder): Promise<GatewayOrder> {
    if (order.status === GatewayOrderStatus.PAID) return order.paymentSubmissionId ? order : this.finish(order);
    if (order.status === GatewayOrderStatus.FAILED || !order.providerLinkId) return order;
    const gateway = await this.creds(order.societyId);
    if (!gateway) return order;

    let link;
    try {
      link = await fetchPaymentLink(gateway, order.providerLinkId);
    } catch (err) {
      // Razorpay could not be asked right now; it stays open and is asked again.
      this.logger.warn(`Could not read payment link ${order.providerLinkId} for order ${order.id}: ${err instanceof Error ? err.message : err}`);
      return order;
    }
    const captured = link.payments.find((p) => p.status === 'captured');
    if (link.status === 'paid' && captured) return this.settle(order, captured.paymentId, captured.amountPaise);
    if (link.status === 'expired' || link.status === 'cancelled') {
      await this.prisma.gatewayOrder.updateMany({ where: { id: order.id, status: GatewayOrderStatus.CREATED }, data: { status: GatewayOrderStatus.EXPIRED } });
      return (await this.prisma.gatewayOrder.findUnique({ where: { id: order.id } })) ?? order;
    }
    return order;
  }

  /** Mark the order paid exactly once, then put the payment in the books. */
  private async settle(order: GatewayOrder, providerPaymentId: string, paidPaise: number): Promise<GatewayOrder> {
    const claimed = await this.prisma.gatewayOrder.updateMany({
      // A payment that lands just after the page expired is still money received.
      where: { id: order.id, status: { in: [GatewayOrderStatus.CREATED, GatewayOrderStatus.EXPIRED] } },
      data: { status: GatewayOrderStatus.PAID, providerPaymentId, paidAt: new Date(), amount: new Prisma.Decimal(fromPaise(paidPaise)) },
    });
    let fresh = await this.prisma.gatewayOrder.findUnique({ where: { id: order.id } });
    if (!fresh) return order;
    if (claimed.count === 1) return this.finish(fresh);
    // Lost the claim to another arrival, which is recording it: give it a moment to finish, so the answer is the settled one.
    for (let i = 0; i < 30 && !fresh.paymentSubmissionId; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      fresh = (await this.prisma.gatewayOrder.findUnique({ where: { id: order.id } })) ?? fresh;
    }
    return fresh;
  }

  /** Record a paid order's payment in the books (idempotent: the payment id can only be applied once). */
  private async finish(order: GatewayOrder): Promise<GatewayOrder> {
    if (!order.providerPaymentId) return order;
    const gateway = await this.prisma.societyPaymentGateway.findUnique({ where: { societyId: order.societyId }, select: { settlementAccountId: true } });
    try {
      const { payment } = await this.payments.recordOnline(order.societyId, {
        userId: order.userId,
        flatId: order.flatId,
        billId: order.maintenanceBillId,
        amount: order.amount,
        providerPaymentId: order.providerPaymentId,
        paidAt: order.paidAt ?? new Date(),
        accountId: gateway?.settlementAccountId ?? null,
      });
      return await this.prisma.gatewayOrder.update({ where: { id: order.id }, data: { paymentSubmissionId: payment.id } });
    } catch (err) {
      // Left paid-but-unrecorded; the background pass tries again.
      this.logger.error(`Order ${order.id} is paid (${order.providerPaymentId}) but could not be recorded yet: ${err instanceof Error ? err.message : err}`);
      return order;
    }
  }

  // ── the page Razorpay sends the person back to ───────────────────────────────────────────────────────────────────────

  /**
   * The person has come back from paying. Acts only on a callback signed with the society's own secret, and even then
   * reads Razorpay for the truth. Anything else gets a calm "we will confirm it" page and changes nothing.
   */
  async handleReturn(query: LinkCallback): Promise<{ outcome: OrderOutcome | 'UNKNOWN'; amount: string | null }> {
    const ref = query.razorpay_payment_link_reference_id;
    if (!ref || !/^[0-9a-f-]{36}$/i.test(ref)) return { outcome: 'UNKNOWN', amount: null };
    const order = await this.prisma.gatewayOrder.findUnique({ where: { id: ref } });
    if (!order || order.providerLinkId !== query.razorpay_payment_link_id) return { outcome: 'UNKNOWN', amount: null };
    const gateway = await this.creds(order.societyId);
    if (!gateway || !callbackIsSigned(query, gateway.keySecret)) return { outcome: 'UNKNOWN', amount: null };
    const now = await this.confirm(order);
    return { outcome: (await this.view1(now)).outcome, amount: now.amount.toString() };
  }

  // ── the background pass ──────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Orders whose answer never reached us (the person paid in their UPI app and never came back to the page or the app)
   * are read from Razorpay here, and paid ones whose recording failed are retried. Returns how many it settled.
   */
  async reconcile(now = new Date()): Promise<number> {
    await this.prisma.gatewayOrder.updateMany({
      where: { status: GatewayOrderStatus.CREATED, createdAt: { lt: new Date(now.getTime() - ORDER_LIFE_MS) } },
      data: { status: GatewayOrderStatus.EXPIRED },
    });
    const open = await this.prisma.gatewayOrder.findMany({
      where: {
        OR: [
          { status: GatewayOrderStatus.CREATED, providerLinkId: { not: null }, createdAt: { gt: new Date(now.getTime() - ORDER_LIFE_MS) } },
          { status: GatewayOrderStatus.PAID, paymentSubmissionId: null },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let settled = 0;
    for (const o of open) {
      const after = await this.confirm(o);
      if (after.status === GatewayOrderStatus.PAID && after.paymentSubmissionId && (o.status !== GatewayOrderStatus.PAID || !o.paymentSubmissionId)) settled += 1;
    }
    return settled;
  }
}
