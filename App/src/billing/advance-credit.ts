import { Prisma } from '@prisma/client';
import { refreshPeriodTotals } from './period-totals';

/**
 * Put a flat's advance credit to work on a period's bills as they are published.
 *
 * Called inside the publish transaction. The flats that hold credit are locked first (the caller does
 * that, ordered by id, before touching any bill — the same order a payment's settlement uses), so a
 * credit is spent once even if a payment lands at the same moment.
 *
 * For each bill of the period, the flat's credit pays as much of it as it can: the whole bill if the
 * credit covers it, otherwise the credit's whole balance and the rest stays owing. The use is written to
 * the flat's ledger against that bill, so the sheet can show how much of the bill was paid in advance.
 */
export async function applyCreditToPeriod(
  tx: Prisma.TransactionClient,
  societyId: string,
  periodId: string,
  /** Only these flats: for a caller that holds the locks on just those flats. */
  onlyFlatIds?: string[],
): Promise<{ billsCovered: number; applied: Prisma.Decimal }> {
  const bills = await tx.maintenanceBill.findMany({
    where: {
      societyId,
      billingPeriodId: periodId,
      isPaid: false,
      pendingAmount: { gt: 0 },
      flat: { creditBalance: { gt: 0 } },
      ...(onlyFlatIds ? { flatId: { in: onlyFlatIds } } : {}),
    },
    select: { id: true, flatId: true, pendingAmount: true },
    orderBy: { flatCode: 'asc' },
  });

  let applied = new Prisma.Decimal(0);
  let billsCovered = 0;
  for (const bill of bills) {
    const flat = await tx.flat.findUniqueOrThrow({ where: { id: bill.flatId }, select: { creditBalance: true } });
    if (flat.creditBalance.lessThanOrEqualTo(0)) continue;
    const use = flat.creditBalance.lessThan(bill.pendingAmount) ? flat.creditBalance : bill.pendingAmount;

    await tx.flat.update({ where: { id: bill.flatId }, data: { creditBalance: { decrement: use } } });
    const updated = await tx.maintenanceBill.update({ where: { id: bill.id }, data: { paidAmount: { increment: use } } });
    const pending = updated.totalAmount.minus(updated.paidAmount);
    await tx.maintenanceBill.update({
      where: { id: bill.id },
      data: { pendingAmount: pending.lessThan(0) ? new Prisma.Decimal(0) : pending, isPaid: pending.lessThanOrEqualTo(0) },
    });
    await tx.flatCreditEntry.create({
      data: { societyId, flatId: bill.flatId, amount: use.negated(), kind: 'APPLIED_TO_BILL', billId: bill.id },
    });
    applied = applied.plus(use);
    billsCovered += 1;
  }
  if (billsCovered > 0) await refreshPeriodTotals(tx, societyId, periodId);
  return { billsCovered, applied };
}
