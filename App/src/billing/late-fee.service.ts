import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LateFeeSettings, lateFeeAmount, lateFeeEnabled, overdueDueDateCutoff } from './late-fee';
import { refreshPeriodTotals } from './period-totals';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Puts the late fine on bills that are past their due date, and takes it off when the committee waives it.
 *
 * It runs by itself every hour (and once shortly after start-up); the admin can also run it from the
 * screen. Running it twice, or from two servers at once, is harmless: each bill is claimed with a
 * conditional update, so a bill is fined once and only once.
 */
@Injectable()
export class LateFeeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LateFeeService.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Tests drive it directly; a timer would only keep them from exiting.
    if (process.env.NODE_ENV === 'test' || process.env.LATE_FEE_JOB === 'off') return;
    const run = () => void this.applyAll().catch((e) => this.logger.error(`Late fee run failed: ${e instanceof Error ? e.message : e}`));
    this.first = setTimeout(run, 60_000);
    this.timer = setInterval(run, HOUR_MS);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  /** Every society that has a fine switched on. */
  async applyAll(now = new Date()): Promise<{ societies: number; applied: number }> {
    const configs = await this.prisma.societyConfiguration.findMany({
      where: { lateFeeType: { in: ['FIXED', 'PERCENTAGE'] }, lateFeeValue: { gt: 0 } },
      select: { societyId: true },
    });
    let applied = 0;
    for (const c of configs) {
      try {
        applied += (await this.applyForSociety(c.societyId, now)).applied;
      } catch (e) {
        // One society's trouble must not stop the others being fined.
        this.logger.error(`Late fees for society ${c.societyId} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { societies: configs.length, applied };
  }

  async applyForSociety(societyId: string, now = new Date()): Promise<{ applied: number; total: string }> {
    const config = await this.prisma.societyConfiguration.findUnique({
      where: { societyId },
      select: { lateFeeType: true, lateFeeValue: true, lateFeeMaxAmount: true, gracePeriodDays: true },
    });
    if (!config || !lateFeeEnabled(config)) return { applied: 0, total: '0' };
    const settings: LateFeeSettings = config;

    const candidates = await this.prisma.maintenanceBill.findMany({
      where: {
        societyId,
        isPublished: true,
        isPaid: false,
        pendingAmount: { gt: 0 },
        lateFeeAppliedAt: null,
        dueDate: { lte: overdueDueDateCutoff(settings.gracePeriodDays, now) },
      },
      select: { id: true },
    });

    let applied = 0;
    let total = new Prisma.Decimal(0);
    for (const { id } of candidates) {
      const fee = await this.prisma.$transaction(async (tx) => {
        // The claim: only one caller ever gets past this for a given bill.
        const claimed = await tx.maintenanceBill.updateMany({
          where: { id, societyId, lateFeeAppliedAt: null, isPublished: true, isPaid: false, pendingAmount: { gt: 0 } },
          data: { lateFeeAppliedAt: now },
        });
        if (claimed.count !== 1) return null;

        const bill = await tx.maintenanceBill.findUniqueOrThrow({ where: { id } });
        const amount = lateFeeAmount(settings, bill.pendingAmount);
        if (amount.lessThanOrEqualTo(0)) return null;

        await tx.maintenanceBill.update({
          where: { id },
          data: {
            lateFee: { increment: amount },
            totalAmount: { increment: amount },
            pendingAmount: { increment: amount },
          },
        });
        await tx.billLineItem.create({
          data: {
            maintenanceBillId: id,
            componentName: 'Late fee',
            componentType: 'LATE_FEE',
            amount,
            calculationNote:
              (settings.lateFeeType ?? '').toUpperCase() === 'PERCENTAGE'
                ? `${settings.lateFeeValue!.toString()}% of ₹${bill.pendingAmount.toString()} unpaid after the due date`
                : `Fixed fine after the due date`,
          },
        });
        // No audit row: there is no person to name. The 'Late fee' line on the bill and lateFeeAppliedAt are the record.
        await refreshPeriodTotals(tx, societyId, bill.billingPeriodId);
        return amount;
      });
      if (fee) {
        applied += 1;
        total = total.plus(fee);
      }
    }
    return { applied, total: total.toString() };
  }

  /** Take the fine off one bill. The bill is still counted as fined, so it is not fined again. */
  async waive(societyId: string, billId: string, actorId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      // Hold the bill while its figures are rewritten, so a payment landing now is counted after.
      await tx.$queryRaw`SELECT id FROM maintenance_bills WHERE id = ${billId} AND "societyId" = ${societyId} FOR UPDATE`;
      const bill = await tx.maintenanceBill.findFirst({ where: { id: billId, societyId }, include: { billingPeriod: true } });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.billingPeriod.status === 'CLOSED') throw new ForbiddenException('The period is closed, so its bills cannot be changed.');
      if (bill.lateFee.lessThanOrEqualTo(0)) throw new ForbiddenException('This bill has no late fine to waive.');

      const total = bill.totalAmount.minus(bill.lateFee);
      const pending = total.minus(bill.paidAmount);
      const updated = await tx.maintenanceBill.update({
        where: { id: billId },
        data: {
          lateFee: 0,
          totalAmount: total,
          pendingAmount: pending.lessThan(0) ? new Prisma.Decimal(0) : pending,
          isPaid: pending.lessThanOrEqualTo(0),
          // Stamped even if it never was, so a waived bill is not fined again.
          lateFeeAppliedAt: bill.lateFeeAppliedAt ?? new Date(),
        },
      });
      await tx.billLineItem.deleteMany({ where: { maintenanceBillId: billId, componentType: 'LATE_FEE' } });
      await tx.auditLog.create({
        data: {
          societyId,
          actorId,
          action: 'BILL_MODIFIED',
          entityType: 'MaintenanceBill',
          entityId: billId,
          oldValues: { lateFee: bill.lateFee.toString() } as Prisma.InputJsonValue,
          newValues: { lateFeeWaived: true, reason } as Prisma.InputJsonValue,
        },
      });
      await refreshPeriodTotals(tx, societyId, bill.billingPeriodId);
      return updated;
    });
  }
}
