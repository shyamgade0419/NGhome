import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappSettingsStore } from './whatsapp-settings.store';
import { pickBillContact } from '../billing/billing-contact';
import { MONTH_NAMES, readFinalReminderTemplate, readReminderTemplate, renderReminder } from '../billing/reminder-template';
import { outstandingForFlat } from '../payments/settlement';
import { fineMessage, paidMessage, publishedMessage } from './whatsapp-messages';
import {
  GatewayConfig, GatewayCreds, GatewayError, sendText, sessionStatus, startSession,
} from './openwa.client';
import { CLOUD_LANGUAGE, TEST_TEMPLATE, orderedParams, renderTemplate, templateOf } from './whatsapp-cloud-templates';
import { receiptUrl } from '../receipts/receipt-link';
import { sendTemplate } from './whatsapp-cloud.client';
import { WhatsappCloudService, WhatsappProvider } from './whatsapp-cloud.service';
import {
  chatIdFor, inSendWindow, istDayStart, istParts, normalizePhone, readWhatsappSettings,
} from './whatsapp-settings';

export type WhatsappKind = 'BILL_PUBLISHED' | 'REMINDER' | 'FINE_IMPOSED' | 'PAYMENT_RECEIVED' | 'TEST';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** A message is tried this many times before it is given up on. */
const MAX_ATTEMPTS = 3;
/** A message left "sending" this long was lost with a crashed process; it goes back to the queue. */
const STUCK_AFTER_MS = 10 * MINUTE_MS;

/** Pause between two messages, random so the pattern is not mechanical: an unofficial number that fires a burst is banned. */
const gapMs = () => {
  const min = Number(process.env.WHATSAPP_SEND_GAP_MIN_MS ?? 6_000);
  const max = Math.max(min, Number(process.env.WHATSAPP_SEND_GAP_MAX_MS ?? 14_000));
  return Math.round(min + Math.random() * (max - min));
};
/** The official API has no ban to avoid, so its pause is only to stay polite to Meta. */
const cloudGapMs = () => Number(process.env.WHATSAPP_CLOUD_GAP_MS ?? 250);
const dailyCap = () => Number(process.env.WHATSAPP_DAILY_CAP ?? 250);
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

interface Recipient {
  userId: string;
  name: string;
  phone: string;
}

export interface DrainOptions {
  now?: Date;
  /** Pause between messages; tests pass 0. */
  gap?: () => number;
  /** Most messages one run sends; the next run carries on. */
  maxPerRun?: number;
  /** Tests only: send outside the daytime window. */
  ignoreWindow?: boolean;
}

/**
 * WhatsApp automation: a bill is published, a flat is reminded, a late fine is added, a payment is received — each
 * is one message to the person the flat's bills go to (the tenant, else the owner).
 *
 * Events never send. They add a row to an outbox (whatsapp_messages) and carry on, so a slow or logged-out WhatsApp
 * can never delay or fail a bill, a payment or a login. A worker then sends the rows one at a time, spaced out, in
 * the daytime only, with a daily cap: that is what keeps an unofficial number from being banned. A row is
 * keyed by its event, so seeing an event twice (a job that runs hourly, a retry) still sends one message.
 */
@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private drainTimer?: NodeJS.Timeout;
  private reminderTimer?: NodeJS.Timeout;
  private firstRun?: NodeJS.Timeout;
  private draining = false;
  /** When each society's session was last started again by the sender, so a stuck one is not restarted in a loop. */
  private readonly restartedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WhatsappSettingsStore,
    private readonly cloud: WhatsappCloudService,
  ) {}

  onModuleInit() {
    // Tests drive it directly; a timer would only keep them from exiting.
    if (process.env.NODE_ENV === 'test' || process.env.WHATSAPP_JOB === 'off') return;
    const drain = () => void this.drain().catch((e) => this.logger.error(`WhatsApp send run failed: ${e instanceof Error ? e.message : e}`));
    const reminders = () => void this.remindersPass().catch((e) => this.logger.error(`WhatsApp reminder pass failed: ${e instanceof Error ? e.message : e}`));
    this.firstRun = setTimeout(() => { reminders(); drain(); }, 90_000);
    this.drainTimer = setInterval(drain, MINUTE_MS);
    this.reminderTimer = setInterval(reminders, HOUR_MS);
    for (const t of [this.firstRun, this.drainTimer, this.reminderTimer]) t.unref();
  }

  onModuleDestroy() {
    for (const t of [this.firstRun, this.drainTimer, this.reminderTimer]) if (t) clearTimeout(t);
  }

  /** The platform has a WhatsApp gateway set up (an address and a key, saved in the console or in the environment). */
  async isConfigured(): Promise<boolean> {
    return (await this.settings.creds()) !== null;
  }

  // ─── Who and what ───────────────────────────────────────────────────────────────────────────────

  private async settingsOf(societyId: string) {
    const [config, society, cloudLinked] = await Promise.all([
      this.prisma.societyConfiguration.findUnique({ where: { societyId }, select: { additionalConfig: true } }),
      this.prisma.society.findUnique({ where: { id: societyId }, select: { whatsappAllowed: true, isActive: true, deletedAt: true, whatsappSessionId: true, whatsappProvider: true } }),
      this.cloud.isLinked(societyId),
    ]);
    const provider: WhatsappProvider = society?.whatsappProvider === 'CLOUD' ? 'CLOUD' : 'OPENWA';
    return {
      ...readWhatsappSettings(config?.additionalConfig),
      additionalConfig: config?.additionalConfig,
      // The platform owner decides which societies may use WhatsApp at all, by either way. A suspended or deleted
      // society never sends.
      allowed: !!society && society.whatsappAllowed && society.isActive && !society.deletedAt,
      provider,
      // The society's own session on the gateway, set when it linked its number.
      sessionId: society?.whatsappSessionId ?? null,
      // The society connected its own Meta WhatsApp Business account.
      cloudLinked,
      // Somewhere to send from, by the way the society chose.
      linked: provider === 'CLOUD' ? cloudLinked : !!society?.whatsappSessionId,
    };
  }

  /**
   * The text of a message and the values it was written from. A society on the official API sends an approved template,
   * so its history shows the template's wording; a society on a linked number sends the free text.
   */
  private compose(provider: WhatsappProvider, kind: Exclude<WhatsappKind, 'TEST'>, values: Record<string, string>, text: string) {
    const t = templateOf(kind);
    return provider === 'CLOUD' && t ? { body: renderTemplate(t, values), params: values } : { body: text, params: values };
  }

  /** Has Meta approved this optional template (the receipt one, the follow-up reminder) on this society's account? */
  private async optionalTemplateApproved(societyId: string, kind: 'PAYMENT_RECEIPT' | 'REMINDER_FINAL'): Promise<boolean> {
    try {
      const state = await this.cloud.state(societyId);
      return state.templates.some((t) => t.kind === kind && t.status === 'APPROVED');
    } catch {
      return false; // cannot tell: send the usual message rather than hold it
    }
  }

  private async societyName(societyId: string): Promise<string> {
    const s = await this.prisma.society.findUnique({ where: { id: societyId }, select: { name: true, displayName: true } });
    return s?.displayName || s?.name || 'Society';
  }

  /**
   * The person a flat's messages go to: the tenant, else the owner — among those who have a usable phone number,
   * so a tenant with no number does not leave the flat unreached while its owner has one.
   */
  private async contactsOf(societyId: string, flatIds: string[]): Promise<Map<string, Recipient>> {
    const rows = await this.prisma.societyMembership.findMany({
      where: { societyId, flatId: { in: flatIds }, status: 'ACTIVE', role: 'RESIDENT' },
      select: {
        flatId: true, userId: true, residencyType: true, isPrimary: true, joinedAt: true,
        user: { select: { firstName: true, lastName: true, phone: true } },
      },
    });
    const byFlat = new Map<string, typeof rows>();
    for (const r of rows) if (r.flatId && normalizePhone(r.user.phone)) byFlat.set(r.flatId, [...(byFlat.get(r.flatId) ?? []), r]);
    const out = new Map<string, Recipient>();
    for (const [flatId, candidates] of byFlat) {
      const c = pickBillContact(candidates);
      if (c) out.set(flatId, { userId: c.userId, name: `${c.user.firstName} ${c.user.lastName}`.trim(), phone: normalizePhone(c.user.phone) as string });
    }
    return out;
  }

  /** Add one message to the outbox. A second add for the same event is ignored. Returns whether a row was added. */
  private async enqueue(
    societyId: string,
    kind: WhatsappKind,
    dedupeKey: string,
    to: Recipient,
    message: { body: string; params?: Record<string, string> },
  ): Promise<boolean> {
    try {
      await this.prisma.whatsappMessage.create({
        data: { societyId, kind, dedupeKey, recipientUserId: to.userId, toPhone: to.phone, body: message.body, ...(message.params ? { params: message.params } : {}) },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  /** Whether events should produce messages for this society at all. */
  private async active(societyId: string) {
    const s = await this.settingsOf(societyId);
    if (!s.enabled || !s.allowed) return null;
    // A society with nowhere to send from queues nothing. A linked number needs the platform's gateway; a Meta account does not.
    if (s.provider === 'CLOUD') return s.cloudLinked ? s : null;
    return s.sessionId && (await this.isConfigured()) ? s : null;
  }

  // ─── Events ─────────────────────────────────────────────────────────────────────────────────────

  /** The bills of a period were published: tell each flat's contact what is due and by when. */
  async enqueuePublished(societyId: string, periodId: string): Promise<number> {
    const settings = await this.active(societyId);
    if (!settings) return 0;
    const period = await this.prisma.billingPeriod.findFirst({ where: { id: periodId, societyId } });
    if (!period) return 0;
    const bills = await this.prisma.maintenanceBill.findMany({
      where: { societyId, billingPeriodId: periodId, isPublished: true, isPaid: false, pendingAmount: { gt: 0 } },
      select: { id: true, flatId: true, flatCode: true, pendingAmount: true },
    });
    const contacts = await this.contactsOf(societyId, bills.map((b) => b.flatId));
    const society = await this.societyName(societyId);
    const month = `${MONTH_NAMES[period.periodMonth] ?? ''} ${period.periodYear}`.trim();
    const dueDate = dueLabel(period.dueDate);
    let added = 0;
    for (const b of bills) {
      const to = contacts.get(b.flatId);
      if (!to) continue;
      const text = publishedMessage({ name: to.name, flat: b.flatCode, month, pending: b.pendingAmount.toString(), dueDate, society });
      const message = this.compose(settings.provider, 'BILL_PUBLISHED', { name: to.name, month, flat: b.flatCode, amount: amountOf(b.pendingAmount), dueDate, society }, text);
      if (await this.enqueue(societyId, 'BILL_PUBLISHED', `published:${b.id}`, to, message)) added += 1;
    }
    return added;
  }

  /** A late fine was added to a bill: tell the flat's contact, with the new amount due. */
  async enqueueFine(societyId: string, billId: string): Promise<boolean> {
    const settings = await this.active(societyId);
    if (!settings) return false;
    const bill = await this.prisma.maintenanceBill.findFirst({ where: { id: billId, societyId }, include: { billingPeriod: true } });
    if (!bill || bill.lateFee.lessThanOrEqualTo(0)) return false;
    const to = (await this.contactsOf(societyId, [bill.flatId])).get(bill.flatId);
    if (!to) return false;
    const month = `${MONTH_NAMES[bill.billingPeriod.periodMonth] ?? ''} ${bill.billingPeriod.periodYear}`.trim();
    const society = await this.societyName(societyId);
    const text = fineMessage({ name: to.name, flat: bill.flatCode, month, fee: bill.lateFee.toString(), pending: bill.pendingAmount.toString(), society });
    const message = this.compose(settings.provider, 'FINE_IMPOSED', { name: to.name, month, flat: bill.flatCode, fee: amountOf(bill.lateFee), amount: amountOf(bill.pendingAmount), society }, text);
    return this.enqueue(societyId, 'FINE_IMPOSED', `fine:${bill.id}`, to, message);
  }

  /** A payment was approved (or recorded by the admin): thank the person and say what is still due. */
  async enqueuePaid(societyId: string, paymentId: string): Promise<boolean> {
    const settings = await this.active(societyId);
    if (!settings) return false;
    const payment = await this.prisma.paymentSubmission.findFirst({
      where: { id: paymentId, societyId, status: 'APPROVED' },
      include: { user: { select: { firstName: true, lastName: true, phone: true } }, flat: { select: { flatCode: true } } },
    });
    if (!payment) return false;
    // The person who paid; failing that, whoever the flat's bills go to.
    let to: Recipient | undefined;
    const ownPhone = normalizePhone(payment.user.phone);
    if (ownPhone) to = { userId: payment.userId, name: `${payment.user.firstName} ${payment.user.lastName}`.trim(), phone: ownPhone };
    else to = (await this.contactsOf(societyId, [payment.flatId])).get(payment.flatId);
    if (!to) return false;
    const balance = await outstandingForFlat(this.prisma, societyId, payment.flatId);
    const society = await this.societyName(societyId);
    const paidOn = dueLabel(payment.paymentDate);
    // A link that opens this payment's receipt, with no login. Null only if the server has nothing to sign it with.
    const receipt = receiptUrl(payment.id);
    const text = paidMessage({ name: to.name, flat: payment.flat.flatCode, amount: payment.amount.toString(), paidOn, balance: balance.toString(), society, receiptUrl: receipt ?? undefined });
    const values = { name: to.name, amount: amountOf(payment.amount), flat: payment.flat.flatCode, paidOn, balance: amountOf(balance), society };
    let message = this.compose(settings.provider, 'PAYMENT_RECEIVED', values, text);
    // Through Meta the link needs its own template. Used once Meta has approved it for this society; until then the usual
    // template goes without the link, so nothing is held up waiting for it.
    if (settings.provider === 'CLOUD' && receipt) {
      const withLink = templateOf('PAYMENT_RECEIPT');
      if (withLink && (await this.optionalTemplateApproved(societyId, 'PAYMENT_RECEIPT'))) {
        const linked = { ...values, receipt };
        message = { body: renderTemplate(withLink, linked), params: linked };
      }
    }
    return this.enqueue(societyId, 'PAYMENT_RECEIVED', `paid:${payment.id}`, to, message);
  }

  /**
   * Remind every flat that still owes, on the society's reminder days (the 5th and 10th unless changed). One
   * message per flat per day, however many months it owes: it names the latest bill and the total outstanding. A
   * flat whose resident has already submitted a payment that is waiting for approval is left alone.
   */
  async enqueueReminders(societyId: string, now = new Date()): Promise<number> {
    const settings = await this.active(societyId);
    if (!settings) return 0;
    const { date, day } = istParts(now);
    if (!settings.reminderDays.includes(day)) return 0;

    const bills = await this.prisma.maintenanceBill.findMany({
      where: { societyId, isPublished: true, isPaid: false, pendingAmount: { gt: 0 } },
      include: { billingPeriod: true },
      orderBy: [{ billingPeriod: { periodYear: 'desc' } }, { billingPeriod: { periodMonth: 'desc' } }],
    });
    if (bills.length === 0) return 0;

    const awaiting = new Set(
      (
        await this.prisma.paymentSubmission.findMany({
          where: { societyId, status: { in: ['PENDING', 'UNDER_REVIEW'] }, maintenanceBillId: { in: bills.map((b) => b.id) } },
          select: { flatId: true },
        })
      ).map((p) => p.flatId),
    );

    const perFlat = new Map<string, { latest: (typeof bills)[number]; owed: Prisma.Decimal }>();
    for (const b of bills) {
      const seen = perFlat.get(b.flatId);
      perFlat.set(b.flatId, seen ? { latest: seen.latest, owed: seen.owed.plus(b.pendingAmount) } : { latest: b, owed: b.pendingAmount });
    }

    const contacts = await this.contactsOf(societyId, [...perFlat.keys()]);
    const template = readReminderTemplate(settings.additionalConfig);
    const followUpTemplate = readFinalReminderTemplate(settings.additionalConfig);

    // A flat is sent the follow-up wording when it was already reminded about this bill (a reminder queued or sent, for a day
    // after the bill was published) and has still not paid. Judged by what the flat has actually been sent, not by which day of
    // the month it is: a bill published on the 7th is first reminded on the 10th, and that is its first reminder, not its
    // second. A reminder that failed to send does not count, and neither does today's own, so running the pass twice in a day
    // changes nothing. A reminder's day is the one in its key ('reminder:<flat>:<date>'), the day it was meant for.
    const sinceDay = (b: (typeof bills)[number]) => istParts(b.billingPeriod.publishedAt ?? b.billingPeriod.startDate ?? b.createdAt).date;
    const earlier = await this.prisma.whatsappMessage.findMany({
      where: {
        societyId,
        kind: 'REMINDER',
        status: { in: ['SENT', 'PENDING', 'SENDING'] },
        dedupeKey: { startsWith: 'reminder:' },
        // Plenty of history, and no more: a reminder from more than a few months ago is not about this bill.
        createdAt: { gte: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
      },
      select: { dedupeKey: true },
    });
    const remindedBefore = (flatId: string, since: string) =>
      earlier.some((m) => {
        const [, flat, day] = m.dedupeKey.split(':');
        return flat === flatId && day !== undefined && day < date && day >= since;
      });
    // Through Meta, the follow-up goes as its own template once Meta has approved it; until then as the usual reminder.
    const metaFollowUp = settings.provider === 'CLOUD' && (await this.optionalTemplateApproved(societyId, 'REMINDER_FINAL'));
    const followUpMeta = templateOf('REMINDER_FINAL');

    const society = await this.societyName(societyId);
    const upi = ((settings.additionalConfig as { upiId?: unknown } | null)?.upiId as string | undefined) ?? '';
    const money = (d: Prisma.Decimal) => Number(d).toLocaleString('en-IN', { maximumFractionDigits: 2 });

    let added = 0;
    for (const [flatId, { latest, owed }] of perFlat) {
      const to = contacts.get(flatId);
      if (!to || awaiting.has(flatId)) continue;
      const month = `${MONTH_NAMES[latest.billingPeriod.periodMonth] ?? ''} ${latest.billingPeriod.periodYear}`.trim();
      const dueDate = dueLabel(latest.dueDate);
      // The society's own wording is for a linked number; the official API sends its approved template instead.
      const followUp = remindedBefore(flatId, sinceDay(latest));
      const text = renderReminder(followUp ? followUpTemplate : template, {
        name: to.name,
        flat: latest.flatCode,
        month,
        amount: money(owed),
        total: money(latest.totalAmount),
        dueDate,
        invoice: latest.invoiceNumber,
        society,
        upi,
      });
      const values = { name: to.name, flat: latest.flatCode, month, amount: money(owed), dueDate, society };
      let message = this.compose(settings.provider, 'REMINDER', values, text);
      if (followUp && metaFollowUp && followUpMeta) {
        const marked = { ...values, followUp: 'yes' };
        message = { body: renderTemplate(followUpMeta, values), params: marked };
      }
      if (await this.enqueue(societyId, 'REMINDER', `reminder:${flatId}:${date}`, to, message)) added += 1;
    }
    return added;
  }

  /** Every society that has automation switched on: queue today's reminders if today is one of its reminder days. */
  async remindersPass(now = new Date()): Promise<{ societies: number; queued: number }> {
    // Not before the sending window opens: the queue would only hold them, and a society that switches the
    // setting off in the morning should not have the day's reminders already queued.
    if (!inSendWindow(now)) return { societies: 0, queued: 0 };
    // A society that was deleted keeps its settings row; it must never be messaged.
    const configs = await this.prisma.societyConfiguration.findMany({
      where: { society: { deletedAt: null } },
      select: { societyId: true, additionalConfig: true },
    });
    const on = configs.filter((c) => readWhatsappSettings(c.additionalConfig).enabled);
    let queued = 0;
    for (const c of on) {
      try {
        queued += await this.enqueueReminders(c.societyId, now);
      } catch (e) {
        this.logger.error(`WhatsApp reminders for society ${c.societyId} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { societies: on.length, queued };
  }

  // ─── Sending ────────────────────────────────────────────────────────────────────────────────────

  /** The gateway connection for one society's own session. */
  private cfgFor(creds: GatewayCreds, sessionId: string): GatewayConfig {
    return { ...creds, sessionId };
  }

  /**
   * Whether a society's session can send right now: null when it is ready, otherwise why not. A session that has merely
   * dropped (rather than needing a new QR scan) is started again, at most once every ten minutes, because the gateway
   * does not always bring a linked phone back by itself after it restarts. Throws when the gateway itself cannot be
   * reached, which stops the whole run.
   */
  private async sessionReason(cfg: GatewayConfig, now: Date): Promise<string | null> {
    let session;
    try {
      session = await sessionStatus(cfg);
    } catch (err) {
      if (err instanceof GatewayError && err.status === 404) return 'its WhatsApp session no longer exists on the gateway';
      throw err;
    }
    if (['disconnected', 'created', 'failed'].includes(session.status) && now.getTime() - (this.restartedAt.get(cfg.sessionId) ?? 0) > 10 * MINUTE_MS) {
      this.restartedAt.set(cfg.sessionId, now.getTime());
      this.logger.warn(`WhatsApp session ${cfg.sessionId} is ${session.status}; trying to start it again.`);
      try {
        await startSession(cfg, cfg.sessionId);
        session = await sessionStatus(cfg);
      } catch (e) {
        this.logger.warn(`Starting WhatsApp session ${cfg.sessionId} again failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return session.status === 'ready' ? null : `the WhatsApp session is ${session.status}`;
  }

  /**
   * Send what is waiting, one message at a time, in the daytime window only. A society sends the way it chose: through its
   * own linked number on the gateway (paced, with a daily limit, because an unofficial number that bursts is banned), or
   * through its own Meta account (approved templates, no pacing worries). A society that cannot send right now (its session
   * is not ready, its token was refused, it reached its limit) is skipped for this run without holding up the others. The
   * run stops altogether only when the OpenWA gateway itself cannot be used. Safe to run from two servers at once: a message
   * is claimed with a conditional update before it is sent.
   */
  async drain(opts: DrainOptions = {}): Promise<{ sent: number; failed: number; stopped: string | null }> {
    const result = { sent: 0, failed: 0, stopped: null as string | null };
    // The gateway is only needed by societies that send through a linked number; one that sends through Meta does not.
    const creds = await this.settings.creds();
    if (this.draining) return { ...result, stopped: 'already running' };
    const now = opts.now ?? new Date();
    if (!opts.ignoreWindow && !inSendWindow(now)) return { ...result, stopped: 'outside the sending window' };

    this.draining = true;
    try {
      await this.prisma.whatsappMessage.updateMany({
        where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
        data: { status: 'PENDING' },
      });
      const waiting = await this.prisma.whatsappMessage.count({ where: { status: 'PENDING', sendAfter: { lte: now } } });
      if (waiting === 0) return result;

      // Societies whose messages cannot go this run: skipped, not failed, and tried again next run.
      const blocked = new Map<string, string>();
      const context = new Map<string, { enabled: boolean; allowed: boolean; provider: WhatsappProvider; sessionId: string | null }>();
      const readiness = new Map<string, string | null>();
      const cloudCreds = new Map<string, Awaited<ReturnType<WhatsappCloudService['creds']>>>();
      const sentToday = new Map<string, number>();
      const dayStart = istDayStart(now);
      const gap = opts.gap ?? gapMs;
      const cloudGap = opts.gap ?? cloudGapMs;
      let budget = opts.maxPerRun ?? 25;
      let noGateway = false;

      while (budget > 0) {
        const next = await this.prisma.whatsappMessage.findFirst({
          where: { status: 'PENDING', sendAfter: { lte: now }, ...(blocked.size ? { societyId: { notIn: [...blocked.keys()] } } : {}) },
          orderBy: { createdAt: 'asc' },
        });
        if (!next) break;

        if (!context.has(next.societyId)) {
          const p = await this.settingsOf(next.societyId);
          context.set(next.societyId, { enabled: p.enabled, allowed: p.allowed, provider: p.provider, sessionId: p.sessionId });
        }
        const ctx = context.get(next.societyId) as { enabled: boolean; allowed: boolean; provider: WhatsappProvider; sessionId: string | null };

        // Checked again at send time, not only when queued: the society, or the platform owner, may have switched it off since.
        if (next.kind !== 'TEST' && (!ctx.allowed || !ctx.enabled)) {
          const dropped = await this.prisma.whatsappMessage.updateMany({
            where: { id: next.id, status: 'PENDING' },
            data: {
              status: 'FAILED',
              lastError: ctx.allowed ? 'WhatsApp messages were switched off for this society.' : 'This society is not allowed to send WhatsApp messages.',
            },
          });
          if (dropped.count === 1) result.failed += 1;
          continue;
        }

        // How this message goes out: a template through the society's Meta account, or text through its linked number.
        const viaCloud = ctx.provider === 'CLOUD';
        let cfg: GatewayConfig | null = null;
        let meta: Awaited<ReturnType<WhatsappCloudService['creds']>> = null;
        if (viaCloud) {
          if (!cloudCreds.has(next.societyId)) cloudCreds.set(next.societyId, await this.cloud.creds(next.societyId));
          meta = cloudCreds.get(next.societyId) ?? null;
          if (!meta) {
            blocked.set(next.societyId, 'this society has not connected its Meta WhatsApp Business account');
            continue;
          }
        } else {
          if (!ctx.sessionId) {
            blocked.set(next.societyId, 'this society has not linked a WhatsApp number');
            continue;
          }
          if (!creds) {
            noGateway = true;
            blocked.set(next.societyId, 'not configured');
            continue;
          }
          cfg = this.cfgFor(creds, ctx.sessionId);

          if (!readiness.has(ctx.sessionId)) {
            try {
              readiness.set(ctx.sessionId, await this.sessionReason(cfg, now));
            } catch (err) {
              result.stopped = err instanceof Error ? err.message : String(err);
              break;
            }
          }
          const notReady = readiness.get(ctx.sessionId);
          if (notReady) {
            blocked.set(next.societyId, notReady);
            continue;
          }

          // The daily limit protects an unofficial number from a ban: per number, each society's own. Meta has its own limits.
          if (!sentToday.has(next.societyId)) {
            sentToday.set(next.societyId, await this.prisma.whatsappMessage.count({ where: { societyId: next.societyId, status: 'SENT', sentAt: { gte: dayStart } } }));
          }
          if ((sentToday.get(next.societyId) as number) >= dailyCap()) {
            blocked.set(next.societyId, 'the daily limit is reached');
            continue;
          }
        }

        const claimed = await this.prisma.whatsappMessage.updateMany({
          where: { id: next.id, status: 'PENDING' },
          data: { status: 'SENDING', attempts: { increment: 1 } },
        });
        if (claimed.count !== 1) continue;

        try {
          if (viaCloud) await this.sendThroughMeta(meta as NonNullable<typeof meta>, next);
          else await sendText(cfg as GatewayConfig, chatIdFor(next.toPhone), next.body, `${next.societyId}:${next.dedupeKey}`);
          await this.prisma.whatsappMessage.update({ where: { id: next.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
          result.sent += 1;
          budget -= 1;
          sentToday.set(next.societyId, (sentToday.get(next.societyId) ?? 0) + 1);
        } catch (err) {
          const e = err instanceof GatewayError ? err : new GatewayError(err instanceof Error ? err.message : String(err));
          if (e.gatewayDown) {
            // Not this message's fault: put it back as it was.
            await this.prisma.whatsappMessage.update({ where: { id: next.id }, data: { status: 'PENDING', attempts: { decrement: 1 }, lastError: e.message } });
            if (e.societyOnly || e.status === 409 || e.status === 503) {
              // This society's connection cannot send right now (session not ready, token refused, template not approved): skip that society, the others can still send.
              if (viaCloud) this.cloud.invalidate(next.societyId); // so its settings screen shows the problem at once
              blocked.set(next.societyId, e.message);
              continue;
            }
            result.stopped = e.message; // the gateway itself: not reachable, refusing the key, rate limiting
            break;
          }
          const giveUp = e.permanent || next.attempts + 1 >= MAX_ATTEMPTS;
          await this.prisma.whatsappMessage.update({
            where: { id: next.id },
            data: giveUp
              ? { status: 'FAILED', lastError: e.message }
              : { status: 'PENDING', lastError: e.message, sendAfter: new Date(now.getTime() + 15 * MINUTE_MS * (next.attempts + 1)) },
          });
          if (giveUp) result.failed += 1;
          budget -= 1;
        }
        await sleep((viaCloud ? cloudGap : gap)());
      }
      // Nothing could be sent only because societies were skipped: say why, as the first of them.
      if (!result.stopped && result.sent === 0 && result.failed === 0 && blocked.size > 0) result.stopped = noGateway ? 'not configured' : [...blocked.values()][0];
      return result;
    } finally {
      this.draining = false;
    }
  }

  /** One queued message through a society's Meta account: the approved template for its kind, filled with the values it was written from. */
  private async sendThroughMeta(meta: NonNullable<Awaited<ReturnType<WhatsappCloudService['creds']>>>, message: { kind: string; toPhone: string; params: unknown }): Promise<void> {
    const values = (message.params ?? null) as Record<string, unknown> | null;
    // A payment confirmation written with a receipt link goes as the template that carries it.
    const t =
      message.kind === 'PAYMENT_RECEIVED' && values?.receipt
        ? templateOf('PAYMENT_RECEIPT')
        : message.kind === 'REMINDER' && values?.followUp
          ? templateOf('REMINDER_FINAL')
          : templateOf(message.kind);
    if (!t) throw new GatewayError(`There is no WhatsApp template for ${message.kind} messages.`, undefined, false, true);
    // A message queued before the society switched to Meta has no values to fill the template with.
    if (!values) throw new GatewayError('This message was written for a linked number and cannot be sent as a template.', undefined, false, true);
    await sendTemplate(meta, message.toPhone, { name: t.name, language: CLOUD_LANGUAGE }, orderedParams(t, values));
  }

  // ─── For the admin ──────────────────────────────────────────────────────────────────────────────

  /** What the settings screen shows: is it set up, is this society's number connected, what is waiting. */
  async status(societyId: string) {
    const settings = await this.settingsOf(societyId);
    const creds = await this.settings.creds();
    let session: { status: string; phone: string | null } | null = null;
    let problem: string | null = null;
    let templates: boolean | null = null;
    if (settings.allowed && settings.provider === 'CLOUD' && settings.cloudLinked) {
      // The society's own Meta account: is the token accepted, and are the four templates approved.
      const meta = await this.cloud.state(societyId);
      session = meta.status === 'ready' ? { status: 'ready', phone: meta.displayPhone } : { status: meta.status ?? 'error', phone: meta.displayPhone };
      problem = meta.status === 'ready' ? meta.problem : meta.problem;
      templates = meta.templatesReady;
    } else if (creds && settings.allowed && settings.sessionId && settings.provider === 'OPENWA') {
      // Only a society that may use WhatsApp, and has linked a number, is asked about its session.
      try {
        session = await sessionStatus(this.cfgFor(creds, settings.sessionId));
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
    }
    const since = istDayStart(new Date());
    const [queued, sentToday, failed] = await Promise.all([
      this.prisma.whatsappMessage.count({ where: { societyId, status: { in: ['PENDING', 'SENDING'] } } }),
      this.prisma.whatsappMessage.count({ where: { societyId, status: 'SENT', sentAt: { gte: since } } }),
      this.prisma.whatsappMessage.count({ where: { societyId, status: 'FAILED', createdAt: { gte: new Date(Date.now() - 7 * 24 * HOUR_MS) } } }),
    ]);
    return {
      // What this society sends through is set up: the platform's gateway for a linked number (the platform owner's job),
      // or its own Meta account (always the platform's to allow, never to configure).
      configured: settings.provider === 'CLOUD' ? true : creds !== null,
      // Whether the platform owner has allowed this society to use WhatsApp at all.
      allowed: settings.allowed,
      // OPENWA: a number linked to the platform's gateway. CLOUD: the society's own Meta WhatsApp Business account.
      provider: settings.provider,
      // The society has somewhere to send from by the way it chose: a linked number, or a connected Meta account.
      hasSession: settings.linked,
      enabled: settings.enabled,
      reminderDays: settings.reminderDays,
      session: session?.status ?? null,
      // This society's own number.
      sendingFrom: session?.phone ?? null,
      // CLOUD only: all four message templates approved by Meta (null when it cannot be told).
      templatesReady: templates,
      problem,
      queued,
      sentToday,
      failedThisWeek: failed,
    };
  }

  async recent(societyId: string, take = 30) {
    return this.prisma.whatsappMessage.findMany({
      where: { societyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 100),
      select: { id: true, kind: true, toPhone: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true },
    });
  }

  /**
   * Send one test message straight away to a number the admin types, the way the society chose, to prove the connection
   * works end to end. It is logged like any other message. Through Meta it is Meta's own pre-approved `hello_world`
   * template, because a business may only send an approved template to someone who has not messaged it first.
   */
  async sendTest(societyId: string, rawPhone: string): Promise<{ sent: boolean; error?: string }> {
    const s = await this.settingsOf(societyId);
    if (!s.allowed) {
      return { sent: false, error: 'WhatsApp messages are not switched on for your society. Ask the platform owner to allow them.' };
    }
    const phone = normalizePhone(rawPhone);
    if (s.provider === 'CLOUD') {
      const meta = await this.cloud.creds(societyId);
      if (!meta) return { sent: false, error: 'Connect your Meta WhatsApp Business account first.' };
      if (!phone) return { sent: false, error: 'That does not look like a mobile number.' };
      const key = `test:${phone}:${Date.now()}`;
      const body = `Test message "${TEST_TEMPLATE.name}" sent from ${await this.societyName(societyId)} through its WhatsApp Business account.`;
      try {
        await sendTemplate(meta, phone, TEST_TEMPLATE, []);
        await this.prisma.whatsappMessage.create({ data: { societyId, kind: 'TEST', dedupeKey: key, toPhone: phone, body, status: 'SENT', attempts: 1, sentAt: new Date() } });
        return { sent: true };
      } catch (err) {
        return { sent: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    const creds = await this.settings.creds();
    if (!creds) return { sent: false, error: 'WhatsApp has not been set up on this platform yet. Ask the platform owner.' };
    if (!s.sessionId) return { sent: false, error: 'Connect your WhatsApp number first.' };
    if (!phone) return { sent: false, error: 'That does not look like a mobile number.' };
    const society = await this.societyName(societyId);
    const key = `test:${phone}:${Date.now()}`;
    const body = `This is a test message from ${society} on NG Home. If you can read it, WhatsApp reminders are set up.`;
    try {
      await sendText(this.cfgFor(creds, s.sessionId), chatIdFor(phone), body, `${societyId}:${key}`);
      await this.prisma.whatsappMessage.create({ data: { societyId, kind: 'TEST', dedupeKey: key, toPhone: phone, body, status: 'SENT', attempts: 1, sentAt: new Date() } });
      return { sent: true };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** An amount as the templates show it, without the rupee sign (the template has it): 2500 → "2,500". */
function amountOf(d: Prisma.Decimal | number | string): string {
  return Number(d).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** "10 Nov 2026" for a date stored as a calendar day. */
function dueLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
