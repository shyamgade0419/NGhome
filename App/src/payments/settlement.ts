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
 * Whatever is left after every due is cleared is the `excess`: money paid ahead. It is not lost and not
 * refused — it becomes the flat's advance credit (see settleOldestFirst), applied to its next bill.
 */
export function planAllocation(
  bills: { id: string; billingPeriodId: string; pendingAmount: Prisma.Decimal }[],
  amount: Prisma.Decimal,
): { allocations: Allocation[]; excess: Prisma.Decimal } {
  const allocations: Allocation[] = [];
  let left = amount;
  for (const b of bills) {
    if (left.lessThanOrEqualTo(0)) break;
    if (b.pendingAmount.lessThanOrEqualTo(0)) continue;
    const take = left.lessThan(b.pendingAmount) ? left : b.pendingAmount;
    allocations.push({ billId: b.id, periodId: b.billingPeriodId, amount: take });
    left = left.minus(take);
  }
  return { allocations, excess: left.greaterThan(0) ? left : new Prisma.Decimal(0) };
}

/** How many months of a flat's own bill may be paid ahead — a ceiling that catches a mistyped amount. */
export const MAX_ADVANCE_MONTHS = 12;

/**
 * The most a payment may be, for a flat that owes `owed` and whose latest bill is `latestBill`: what it
 * owes plus up to a year ahead. A payment above it is almost always an extra zero.
 */
export function maxPayment(owed: Prisma.Decimal, latestBill: Prisma.Decimal): Prisma.Decimal {
  return owed.plus(latestBill.mul(MAX_ADVANCE_MONTHS));
}

const OPEN = { isPublished: true, isPaid: false } as const;

/** Everything a flat still owes on published bills. */
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

/**
 * Settle a payment against a flat: oldest unpaid month first, and anything beyond what is owed becomes
 * the flat's advance credit.
 *
 * The flat is locked first and then its open bills, for the rest of the transaction, so two payments for
 * one flat approved at the same moment are settled one after the other — the second sees what the first
 * left — and a publish that applies the credit takes the locks in the same order (flat, then bills), so
 * the two can never deadlock.
 */
export async function settleOldestFirst(
  tx: Prisma.TransactionClient,
  societyId: string,
  flatId: string,
  paymentId: string,
  amount: Prisma.Decimal,
): Promise<{ allocations: Allocation[]; credited: Prisma.Decimal }> {
  // NO KEY UPDATE, not UPDATE: still one at a time against another settlement or a publish (both take it),
  // but it does not block the share lock Postgres takes on a flat when ANY bill of it is updated (the
  // foreign-key check). A full lock here deadlocked with the late-fine pass, which holds a bill and needs
  // that share lock while this waits for the bill.
  await tx.$queryRaw`SELECT id FROM flats WHERE id = ${flatId} AND "societyId" = ${societyId} FOR NO KEY UPDATE`;
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

  const { allocations, excess } = planAllocation(bills, amount);

  for (const a of allocations) {
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
  if (allocations.length > 0) {
    await tx.paymentAllocation.createMany({
      data: allocations.map((a) => ({ societyId, paymentId, billId: a.billId, amount: a.amount })),
    });
  }

  if (excess.greaterThan(0)) {
    await tx.flat.update({ where: { id: flatId }, data: { creditBalance: { increment: excess } } });
    await tx.flatCreditEntry.create({
      data: { societyId, flatId, amount: excess, kind: 'ADVANCE_PAYMENT', paymentId },
    });
  }

  for (const periodId of new Set(allocations.map((a) => a.periodId))) {
    await refreshPeriodTotals(tx, societyId, periodId);
  }
  return { allocations, credited: excess };
}
