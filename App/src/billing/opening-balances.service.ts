import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingPeriodKind, BillingPeriodStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyCreditToPeriod } from './advance-credit';
import { refreshPeriodTotals } from './period-totals';
import { CorrectOpeningBalanceDto, SaveOpeningBalancesDto } from './dto/opening-balances.dto';
import {
  ExistingOpening,
  OPENING_PERIOD_MONTH,
  OPENING_PERIOD_YEAR,
  OpeningPlanItem,
  planOpeningBalances,
  summarizePlan,
} from './opening-balances';

const PAID_AGAINST = 'A payment has been recorded against it, so it can no longer be changed.';
const SUBMITTED_AGAINST = 'A payment has been submitted against it, so it can no longer be changed.';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Opening balances: what each flat owed before it moved to NG Home from paper or Excel.
 *
 * They are ordinary published bills in one special period (kind OPENING), so a payment settles them
 * first (oldest), they show as arrears on every statement and in the dues report, and an advance a flat
 * has paid is put against them — with nothing special in any of those. They are never fined: the
 * bill is marked as already fined, since its due date is just the date the old records run to.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every flat with its opening balance (if any) and whether that can still be changed. */
  async list(societyId: string) {
    const period = await this.prisma.billingPeriod.findFirst({ where: { societyId, kind: BillingPeriodKind.OPENING } });
    const [flats, existing, startedBilling] = await Promise.all([
      this.prisma.flat.findMany({
        where: { societyId, deletedAt: null },
        select: {
          id: true,
          flatCode: true,
          memberships: {
            where: { status: 'ACTIVE', role: 'RESIDENT' },
            take: 1,
            select: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.loadExisting(this.prisma, societyId, period?.id ?? null),
      this.prisma.billingPeriod.count({ where: { societyId, kind: BillingPeriodKind.REGULAR, status: { not: BillingPeriodStatus.DRAFT } } }),
    ]);
    const bills = period
      ? await this.prisma.maintenanceBill.findMany({
          where: { societyId, billingPeriodId: period.id },
          select: { flatId: true, totalAmount: true, paidAmount: true, pendingAmount: true, notes: true },
        })
      : [];
    const billByFlat = new Map(bills.map((b) => [b.flatId, b]));
    const lockedByFlat = new Map(existing.map((e) => [e.flatId, e.locked]));

    const rows = flats
      .map((f) => {
        const bill = billByFlat.get(f.id);
        const user = f.memberships[0]?.user;
        return {
          flatId: f.id,
          flatCode: f.flatCode,
          residentName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
          amount: bill ? bill.totalAmount.toString() : null,
          paidAmount: bill ? bill.paidAmount.toString() : '0',
          pendingAmount: bill ? bill.pendingAmount.toString() : '0',
          note: bill?.notes ?? null,
          locked: bill ? lockedByFlat.get(f.id) ?? null : null,
        };
      })
      .sort((a, b) => a.flatCode.localeCompare(b.flatCode, undefined, { numeric: true, sensitivity: 'base' }));

    const sum = (pick: (b: (typeof bills)[number]) => Prisma.Decimal) =>
      bills.reduce((t, b) => t.plus(pick(b)), new Prisma.Decimal(0)).toString();

    return {
      asOfDate: period ? period.endDate : null,
      /** True once a month has been billed: the opening dues are then added to bills people already saw. */
      startedBilling: startedBilling > 0,
      totals: {
        flats: flats.length,
        withBalance: bills.length,
        opening: sum((b) => b.totalAmount),
        paid: sum((b) => b.paidAmount),
        pending: sum((b) => b.pendingAmount),
      },
      rows,
    };
  }

  /**
   * Check the rows (dryRun) or save them. Rows are judged one by one, not all-or-nothing: a flat that is
   * not found or has been paid against is reported and skipped, and the rest go through.
   */
  async save(societyId: string, actorId: string, dto: SaveOpeningBalancesDto) {
    const asOf = new Date(dto.asOfDate);
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('The as-of date is not a valid date.');
    if (asOf.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('The as-of date cannot be in the future: it is the date your old records run to.');
    }

    const flats = await this.prisma.flat.findMany({
      where: { societyId, deletedAt: null },
      select: { id: true, flatCode: true, area: true, category: true },
    });
    const period = await this.prisma.billingPeriod.findFirst({ where: { societyId, kind: BillingPeriodKind.OPENING } });
    const before = planOpeningBalances(dto.rows, flats, await this.loadExisting(this.prisma, societyId, period?.id ?? null));

    const writes = before.some((i) => i.action === 'CREATE' || i.action === 'UPDATE' || i.action === 'REMOVE');
    if (dto.dryRun || !writes) {
      return this.result(before, asOf, !!dto.dryRun);
    }

    let plan: OpeningPlanItem[];
    try {
      plan = await this.prisma.$transaction(
        async (tx) => {
          // Lock the flats being touched, then their opening bills, in id order — the order a payment's
          // settlement uses — so a payment approved at this moment is settled before or after, never between.
          const flatIds = [...new Set(before.map((i) => i.flatId).filter((id): id is string => !!id))].sort();
          if (flatIds.length > 0) {
            await tx.$queryRaw`SELECT id FROM flats WHERE id IN (${Prisma.join(flatIds)}) ORDER BY id FOR NO KEY UPDATE`;
            await tx.$queryRaw`
              SELECT b.id FROM maintenance_bills b
              JOIN billing_periods p ON p.id = b."billingPeriodId"
              WHERE b."societyId" = ${societyId} AND p.kind = 'OPENING' AND b."flatId" IN (${Prisma.join(flatIds)})
              ORDER BY b.id FOR UPDATE`;
          }

          let opening = await tx.billingPeriod.findFirst({ where: { societyId, kind: BillingPeriodKind.OPENING } });
          // Judge again now the locks are held: what was read before may have been paid against since.
          const items = planOpeningBalances(dto.rows, flats, await this.loadExisting(tx, societyId, opening?.id ?? null));
          if (!items.some((i) => i.action === 'CREATE' || i.action === 'UPDATE' || i.action === 'REMOVE')) return items;

          if (!opening) {
            opening = await tx.billingPeriod.create({
              data: {
                societyId,
                kind: BillingPeriodKind.OPENING,
                periodYear: OPENING_PERIOD_YEAR,
                periodMonth: OPENING_PERIOD_MONTH,
                startDate: asOf,
                endDate: asOf,
                dueDate: asOf,
                status: BillingPeriodStatus.PUBLISHED,
                publishedAt: new Date(),
                publishedById: actorId,
                notes: 'Dues carried over from before the society moved to NG Home',
              },
            });
          } else {
            await tx.billingPeriod.update({ where: { id: opening.id }, data: { startDate: asOf, endDate: asOf, dueDate: asOf } });
          }

          const flatById = new Map(flats.map((f) => [f.id, f]));
          const existing = await tx.maintenanceBill.findMany({
            where: { societyId, billingPeriodId: opening.id },
            select: { id: true, flatId: true },
          });
          const billOfFlat = new Map(existing.map((b) => [b.flatId, b.id]));
          const now = new Date();

          const newBills: Prisma.MaintenanceBillCreateManyInput[] = [];
          const newLines: Prisma.BillLineItemCreateManyInput[] = [];
          const removeIds: string[] = [];

          for (const item of items) {
            if (!item.flatId) continue;
            const amount = new Prisma.Decimal(item.amount);
            const flat = flatById.get(item.flatId)!;
            const description = item.note ?? 'Brought forward from the earlier records';

            if (item.action === 'CREATE') {
              const id = randomUUID();
              newBills.push({
                id,
                societyId,
                billingPeriodId: opening.id,
                flatId: flat.id,
                invoiceNumber: `OB-${flat.flatCode}`,
                flatCode: flat.flatCode,
                flatArea: flat.area,
                flatCategory: flat.category,
                baseAmount: amount,
                totalAmount: amount,
                pendingAmount: amount,
                dueDate: asOf,
                isPublished: true,
                // Marked as already fined: the due date is only the date the old records run to.
                lateFeeAppliedAt: now,
                notes: item.note,
                calculationSnapshot: { openingBalance: true, asOfDate: asOf.toISOString(), enteredBy: actorId } as Prisma.InputJsonValue,
              });
              newLines.push({
                maintenanceBillId: id,
                componentName: 'Opening balance',
                componentType: 'OPENING_BALANCE',
                description,
                amount,
              });
            } else if (item.action === 'UPDATE') {
              const billId = billOfFlat.get(flat.id)!;
              await tx.maintenanceBill.update({
                where: { id: billId },
                data: { baseAmount: amount, totalAmount: amount, pendingAmount: amount, dueDate: asOf, notes: item.note },
              });
              await tx.billLineItem.updateMany({ where: { maintenanceBillId: billId }, data: { amount, description } });
            } else if (item.action === 'REMOVE') {
              removeIds.push(billOfFlat.get(flat.id)!);
            }
          }

          if (removeIds.length > 0) {
            await tx.billLineItem.deleteMany({ where: { maintenanceBillId: { in: removeIds } } });
            await tx.maintenanceBill.deleteMany({ where: { id: { in: removeIds }, societyId } });
          }
          if (newBills.length > 0) {
            await tx.maintenanceBill.createMany({ data: newBills });
            await tx.billLineItem.createMany({ data: newLines });
          }

          // A flat that already holds an advance has it put against what it now owes.
          const touched = items.filter((i) => (i.action === 'CREATE' || i.action === 'UPDATE') && i.flatId).map((i) => i.flatId!);
          if (touched.length > 0) await applyCreditToPeriod(tx, societyId, opening.id, touched);
          await refreshPeriodTotals(tx, societyId, opening.id);

          const summary = summarizePlan(items);
          await tx.auditLog.create({
            data: {
              societyId,
              actorId,
              action: 'OTHER',
              entityType: 'OpeningBalances',
              entityId: opening.id,
              newValues: { asOfDate: asOf.toISOString(), ...summary } as Prisma.InputJsonValue,
            },
          });
          return items;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    } catch (err) {
      // Two people saving the first opening balances at once: the second finds the period already there.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Someone else is saving opening balances right now. Try again in a moment.');
      }
      throw err;
    }

    return this.result(plan, asOf, false);
  }

  /**
   * Correct an opening balance that a payment has already touched (an unpaid one is simply edited).
   *
   * The new amount replaces the old. If it is less than what was already paid against it, the difference
   * is money the flat has paid that it did not owe, so it becomes the flat's advance credit; if it is more,
   * the flat owes the rest. Either way the old and new amounts and the reason are written to the audit trail.
   */
  async correct(societyId: string, actorId: string, flatId: string, dto: CorrectOpeningBalanceDto) {
    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    return this.prisma.$transaction(
      async (tx) => {
        // The flat first, then its bills: the order a payment's settlement uses.
        await tx.$queryRaw`SELECT id FROM flats WHERE id = ${flatId} AND "societyId" = ${societyId} FOR NO KEY UPDATE`;
        await tx.$queryRaw`
          SELECT b.id FROM maintenance_bills b
          JOIN billing_periods p ON p.id = b."billingPeriodId"
          WHERE b."societyId" = ${societyId} AND p.kind = 'OPENING' AND b."flatId" = ${flatId}
          ORDER BY b.id FOR UPDATE`;

        const bill = await tx.maintenanceBill.findFirst({
          where: { societyId, flatId, billingPeriod: { kind: BillingPeriodKind.OPENING } },
          include: { flat: { select: { flatCode: true } } },
        });
        if (!bill) throw new NotFoundException('This flat has no opening balance to correct.');
        if (bill.totalAmount.equals(amount)) throw new BadRequestException('The opening balance is already that amount.');

        const paidOnBill = bill.paidAmount.lessThan(amount) ? bill.paidAmount : amount;
        const excess = bill.paidAmount.minus(paidOnBill);
        const pending = amount.minus(paidOnBill);

        await tx.maintenanceBill.update({
          where: { id: bill.id },
          data: { baseAmount: amount, totalAmount: amount, paidAmount: paidOnBill, pendingAmount: pending, isPaid: pending.lessThanOrEqualTo(0) },
        });
        await tx.billLineItem.updateMany({ where: { maintenanceBillId: bill.id }, data: { amount } });

        if (excess.greaterThan(0)) {
          await tx.flat.update({ where: { id: flatId }, data: { creditBalance: { increment: excess } } });
          await tx.flatCreditEntry.create({ data: { societyId, flatId, amount: excess, kind: 'CORRECTION', billId: bill.id } });
        }
        // An advance the flat holds goes against what it now owes.
        if (pending.greaterThan(0)) await applyCreditToPeriod(tx, societyId, bill.billingPeriodId, [flatId]);
        await refreshPeriodTotals(tx, societyId, bill.billingPeriodId);

        await tx.auditLog.create({
          data: {
            societyId,
            actorId,
            action: 'BILL_MODIFIED',
            entityType: 'MaintenanceBill',
            entityId: bill.id,
            oldValues: { openingBalance: bill.totalAmount.toString(), paid: bill.paidAmount.toString() } as Prisma.InputJsonValue,
            newValues: {
              openingBalanceCorrected: true,
              flat: bill.flat.flatCode,
              openingBalance: amount.toString(),
              reason: dto.reason.trim(),
              movedToAdvance: excess.toString(),
            } as Prisma.InputJsonValue,
          },
        });
        return { flatCode: bill.flat.flatCode, previous: bill.totalAmount.toString(), amount: amount.toString(), movedToAdvance: excess.toString() };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  private result(items: OpeningPlanItem[], asOf: Date, dryRun: boolean) {
    return { dryRun, asOfDate: asOf, summary: summarizePlan(items), results: items };
  }

  /** The opening bills stored now, each with why it can no longer be changed (if it cannot). */
  private async loadExisting(db: Db, societyId: string, periodId: string | null): Promise<ExistingOpening[]> {
    if (!periodId) return [];
    const bills = await db.maintenanceBill.findMany({
      where: { societyId, billingPeriodId: periodId },
      select: { id: true, flatId: true, totalAmount: true, paidAmount: true, notes: true },
    });
    if (bills.length === 0) return [];
    // A payment that names the bill is not reflected in paidAmount until it is approved.
    const submitted = await db.paymentSubmission.groupBy({
      by: ['maintenanceBillId'],
      where: { societyId, maintenanceBillId: { in: bills.map((b) => b.id) }, status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED'] } },
      _count: { _all: true },
    });
    const withSubmission = new Set(submitted.map((s) => s.maintenanceBillId));
    return bills.map((b) => ({
      billId: b.id,
      flatId: b.flatId,
      totalAmount: b.totalAmount,
      notes: b.notes,
      locked: b.paidAmount.greaterThan(0) ? PAID_AGAINST : withSubmission.has(b.id) ? SUBMITTED_AGAINST : null,
    }));
  }
}
