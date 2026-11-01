import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickBillContact } from '../billing/billing-contact';
import { MONTH_NAMES, readReminderTemplate, renderReminder } from '../billing/reminder-template';
import { outstandingForFlat } from '../payments/settlement';
import { fineMessage, paidMessage, publishedMessage } from './whatsapp-messages';
import {
  GatewayConfig, GatewayError, readGatewayConfig, sendText, sessionStatus,
} from './openwa.client';
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

  constructor(private readonly prisma: PrismaService) {}

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

  isConfigured(): boolean {
    return readGatewayConfig() !== null;
  }

  // ─── Who and what ───────────────────────────────────────────────────────────────────────────────

  private async settingsOf(societyId: string) {
    const config = await this.prisma.societyConfiguration.findUnique({ where: { societyId }, select: { additionalConfig: true } });
    return { ...readWhatsappSettings(config?.additionalConfig), additionalConfig: config?.additionalConfig };
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
  private async enqueue(societyId: string, kind: WhatsappKind, dedupeKey: string, to: Recipient, body: string): Promise<boolean> {
    try {
      await this.prisma.whatsappMessage.create({
        data: { societyId, kind, dedupeKey, recipientUserId: to.userId, toPhone: to.phone, body },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  /** Whether events should produce messages for this society at all. */
  private async active(societyId: string) {
    if (!this.isConfigured()) return null;
    const s = await this.settingsOf(societyId);
    return s.enabled ? s : null;
  }

  // ─── Events ─────────────────────────────────────────────────────────────────────────────────────

  /** The bills of a period were published: tell each flat's contact what is due and by when. */
  async enqueuePublished(societyId: string, periodId: string): Promise<number> {
    if (!(await this.active(societyId))) return 0;
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
      const body = publishedMessage({ name: to.name, flat: b.flatCode, month, pending: b.pendingAmount.toString(), dueDate, society });
      if (await this.enqueue(societyId, 'BILL_PUBLISHED', `published:${b.id}`, to, body)) added += 1;
    }
    return added;
  }

  /** A late fine was added to a bill: tell the flat's contact, with the new amount due. */
  async enqueueFine(societyId: string, billId: string): Promise<boolean> {
    if (!(await this.active(societyId))) return false;
    const bill = await this.prisma.maintenanceBill.findFirst({ where: { id: billId, societyId }, include: { billingPeriod: true } });
    if (!bill || bill.lateFee.lessThanOrEqualTo(0)) return false;
    const to = (await this.contactsOf(societyId, [bill.flatId])).get(bill.flatId);
    if (!to) return false;
    const body = fineMessage({
      name: to.name,
      flat: bill.flatCode,
      month: `${MONTH_NAMES[bill.billingPeriod.periodMonth] ?? ''} ${bill.billingPeriod.periodYear}`.trim(),
      fee: bill.lateFee.toString(),
      pending: bill.pendingAmount.toString(),
      society: await this.societyName(societyId),
    });
    return this.enqueue(societyId, 'FINE_IMPOSED', `fine:${bill.id}`, to, body);
  }

  /** A payment was approved (or recorded by the admin): thank the person and say what is still due. */
  async enqueuePaid(societyId: string, paymentId: string): Promise<boolean> {
    if (!(await this.active(societyId))) return false;
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
    const body = paidMessage({
      name: to.name,
      flat: payment.flat.flatCode,
      amount: payment.amount.toString(),
      paidOn: dueLabel(payment.paymentDate),
      balance: balance.toString(),
      society: await this.societyName(societyId),
    });
    return this.enqueue(societyId, 'PAYMENT_RECEIVED', `paid:${payment.id}`, to, body);
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
    const society = await this.societyName(societyId);
    const upi = ((settings.additionalConfig as { upiId?: unknown } | null)?.upiId as string | undefined) ?? '';
    const money = (d: Prisma.Decimal) => Number(d).toLocaleString('en-IN', { maximumFractionDigits: 2 });

    let added = 0;
    for (const [flatId, { latest, owed }] of perFlat) {
      const to = contacts.get(flatId);
      if (!to || awaiting.has(flatId)) continue;
      const body = renderReminder(template, {
        name: to.name,
        flat: latest.flatCode,
        month: `${MONTH_NAMES[latest.billingPeriod.periodMonth] ?? ''} ${latest.billingPeriod.periodYear}`.trim(),
        amount: money(owed),
        total: money(latest.totalAmount),
        dueDate: dueLabel(latest.dueDate),
        invoice: latest.invoiceNumber,
        society,
        upi,
      });
      if (await this.enqueue(societyId, 'REMINDER', `reminder:${flatId}:${date}`, to, body)) added += 1;
    }
    return added;
  }

  /** Every society that has automation switched on: queue today's reminders if today is one of its reminder days. */
  async remindersPass(now = new Date()): Promise<{ societies: number; queued: number }> {
    if (!this.isConfigured()) return { societies: 0, queued: 0 };
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

  /**
   * Send what is waiting, one message at a time with a pause between, in the daytime window only, stopping at the
   * daily cap or the moment the gateway or the WhatsApp session is not usable. Safe to run from two servers at once:
   * a message is claimed with a conditional update before it is sent.
   */
  async drain(opts: DrainOptions = {}): Promise<{ sent: number; failed: number; stopped: string | null }> {
    const result = { sent: 0, failed: 0, stopped: null as string | null };
    const cfg = readGatewayConfig();
    if (!cfg) return { ...result, stopped: 'not configured' };
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

      try {
        const session = await sessionStatus(cfg);
        if (session.status !== 'ready') return { ...result, stopped: `the WhatsApp session is ${session.status}` };
      } catch (err) {
        return { ...result, stopped: err instanceof Error ? err.message : String(err) };
      }

      const sentToday = await this.prisma.whatsappMessage.count({ where: { status: 'SENT', sentAt: { gte: istDayStart(now) } } });
      let budget = Math.min(opts.maxPerRun ?? 25, Math.max(0, dailyCap() - sentToday));
      if (budget === 0) return { ...result, stopped: 'the daily limit is reached' };

      const enabledCache = new Map<string, boolean>();
      const gap = opts.gap ?? gapMs;
      while (budget > 0) {
        const next = await this.prisma.whatsappMessage.findFirst({
          where: { status: 'PENDING', sendAfter: { lte: now } },
          orderBy: { createdAt: 'asc' },
        });
        if (!next) break;

        const claimed = await this.prisma.whatsappMessage.updateMany({
          where: { id: next.id, status: 'PENDING' },
          data: { status: 'SENDING', attempts: { increment: 1 } },
        });
        if (claimed.count !== 1) continue;

        if (!enabledCache.has(next.societyId)) enabledCache.set(next.societyId, (await this.settingsOf(next.societyId)).enabled);
        if (next.kind !== 'TEST' && !enabledCache.get(next.societyId)) {
          await this.prisma.whatsappMessage.update({ where: { id: next.id }, data: { status: 'FAILED', lastError: 'WhatsApp messages were switched off for this society.' } });
          result.failed += 1;
          continue;
        }

        try {
          await sendText(cfg, chatIdFor(next.toPhone), next.body, `${next.societyId}:${next.dedupeKey}`);
          await this.prisma.whatsappMessage.update({ where: { id: next.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
          result.sent += 1;
          budget -= 1;
        } catch (err) {
          const e = err instanceof GatewayError ? err : new GatewayError(err instanceof Error ? err.message : String(err));
          if (e.gatewayDown) {
            // Not this message's fault: put it back as it was and stop for now.
            await this.prisma.whatsappMessage.update({ where: { id: next.id }, data: { status: 'PENDING', attempts: { decrement: 1 }, lastError: e.message } });
            result.stopped = e.message;
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
        await sleep(gap());
      }
      return result;
    } finally {
      this.draining = false;
    }
  }

  // ─── For the admin ──────────────────────────────────────────────────────────────────────────────

  /** What the settings screen shows: is it set up, is WhatsApp connected, what is waiting. */
  async status(societyId: string) {
    const settings = await this.settingsOf(societyId);
    const cfg = readGatewayConfig();
    let session: { status: string; phone: string | null } | null = null;
    let problem: string | null = null;
    if (cfg) {
      try {
        session = await sessionStatus(cfg);
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
      configured: cfg !== null,
      enabled: settings.enabled,
      reminderDays: settings.reminderDays,
      session: session?.status ?? null,
      sendingFrom: session?.phone ?? null,
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
   * Send one message straight away to a number the admin types, to prove the connection works end to end. Goes
   * through the queue's own sender, so it counts toward the daily cap and is logged like any other.
   */
  async sendTest(societyId: string, rawPhone: string): Promise<{ sent: boolean; error?: string }> {
    const cfg: GatewayConfig | null = readGatewayConfig();
    if (!cfg) return { sent: false, error: 'WhatsApp is not connected to this server yet (see the setup notes).' };
    const phone = normalizePhone(rawPhone);
    if (!phone) return { sent: false, error: 'That does not look like a mobile number.' };
    const society = await this.societyName(societyId);
    const key = `test:${phone}:${Date.now()}`;
    const body = `This is a test message from ${society} on NG Home. If you can read it, WhatsApp reminders are set up.`;
    try {
      await sendText(cfg, chatIdFor(phone), body, `${societyId}:${key}`);
      await this.prisma.whatsappMessage.create({ data: { societyId, kind: 'TEST', dedupeKey: key, toPhone: phone, body, status: 'SENT', attempts: 1, sentAt: new Date() } });
      return { sent: true };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** "10 Nov 2026" for a date stored as a calendar day. */
function dueLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
