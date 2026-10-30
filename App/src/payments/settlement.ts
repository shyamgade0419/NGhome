import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { refreshPeriodTotals } from '../billing/period-totals';

/** The rows a payment settles, oldest first: how much of each bill it covers. */
export interface Allocation {
  billId: string;
  periodId: string;
  amount: Prisma.Decimal;
}

/**
 * Share `amount` across a flat's unpaid published bills, oldest month first. This is what makes an
 * unpaid month carry forward and "settle" when paid: a payment clears the oldest dues before newer ones,
 * so arrears never sit while a newer month reads as paid.
 *
 * The flat's open bills are locked for the rest of the transaction before anything is read, so two
 * payments for the same flat approved at the same moment are settled one after the other — the second
 * sees what the first left — and together can never pay more than is owed. A payment larger than
 * everything owed is refused (there is no advance credit yet), and nothing is written.
 */
export function planAllocation(
  bills: { id: string; billingPeriodId: string; pendingAmount: Prisma.Decimal }[],
  amount: Prisma.Decimal,
): Allocation[] {
  const plan: Allocation[] = [];
  let left = amount;
  for (const b of bills) {
    if (left.lessThanOrEqualTo(0)) break;
    if (b.pendingAmount.lessThanOrEqualTo(0)) continue;
    const take = left.lessThan(b.pendingAmount) ? left : b.pendingAmount;
    plan.push({ billId: b.id, periodId: b.billingPeriodId, amount: take });
    left = left.minus(take);
  }
  if (left.greaterThan(0)) {
    const owed = bills.reduce((s, b) => s.plus(b.pendingAmount.greaterThan(0) ? b.pendingAmount : 0), new Prisma.Decimal(0));
    throw new BadRequestException(`Payment amount exceeds what this flat owes (₹${owed.toString()}).`);
  }
  return plan;
}

const OPEN = { isPublished: true, isPaid: false } as const;

/** Everything a flat still owes on published bills — what a payment may be up to. */
export async function outstandingForFlat(
  client: Prisma.TransactionClient | { maintenanceBill: Prisma.TransactionClient['maintenanceBill'] },
  societyId: string,
  flatId: string,
): Promise<Prisma.Decimal> {
  const sums = await client.maintenanceBill.aggregate({
    where: { societyId, flatId, ...OPEN, pendingAmount: { gt: 0 } },
    _sum: { pendingAmount: true },
  });
  return sums._sum.pendingAmount ?? new Prisma.Decimal(0);
}

export async function settleOldestFirst(
  tx: Prisma.TransactionClient,
  societyId: string,
  flatId: string,
  paymentId: string,
  amount: Prisma.Decimal,
): Promise<Allocation[]> {
  // Ordered by id, so two settlements locking the same flat's bills take them in the same order.
  await tx.$queryRaw`
    SELECT id FROM maintenance_bills
    WHERE "societyId" = ${societyId} AND "flatId" = ${flatId} AND "isPublished" = true AND "isPaid" = false
    ORDER BY id FOR UPDATE`;

  const bills = await tx.maintenanceBill.findMany({
    where: { societyId, flatId, ...OPEN, pendingAmount: { gt: 0 } },
    select: { id: true, billingPeriodId: true, pendingAmount: true, billingPeriod: { select: { periodYear: true, periodMonth: true } } },
  });
  bills.sort(
    (a, b) =>
      a.billingPeriod.periodYear - b.billingPeriod.periodYear ||
      a.billingPeriod.periodMonth - b.billingPeriod.periodMonth,
  );

  const plan = planAllocation(bills, amount);

  for (const a of plan) {
    const updated = await tx.maintenanceBill.update({
      where: { id: a.billId },
      data: { paidAmount: { increment: a.amount } },
    });
    // Decimal, not float: on a float a bill with paise can land on 1e-13 and stay "unpaid" for ever.
    const pending = updated.totalAmount.minus(updated.paidAmount);
    await tx.maintenanceBill.update({
      where: { id: a.billId },
      data: {
        pendingAmount: pending.lessThan(0) ? new Prisma.Decimal(0) : pending,
        isPaid: pending.lessThanOrEqualTo(0),
      },
    });
  }
  if (plan.length > 0) {
    await tx.paymentAllocation.createMany({
      data: plan.map((a) => ({ societyId, paymentId, billId: a.billId, amount: a.amount })),
    });
  }
  for (const periodId of new Set(plan.map((a) => a.periodId))) {
    await refreshPeriodTotals(tx, societyId, periodId);
  }
  return plan;
}
