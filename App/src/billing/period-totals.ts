import { Prisma } from '@prisma/client';

/**
 * Re-add a period's billed, collected and pending totals from its bills. They were written once, when
 * the bills were generated, and never again — so "Collected" stayed at zero however much was paid.
 * Called whenever a bill's amounts change (a payment settles it, a fine is added or waived).
 */
export async function refreshPeriodTotals(tx: Prisma.TransactionClient, societyId: string, periodId: string): Promise<void> {
  const sums = await tx.maintenanceBill.aggregate({
    where: { societyId, billingPeriodId: periodId },
    _sum: { totalAmount: true, paidAmount: true, pendingAmount: true },
  });
  await tx.billingPeriod.updateMany({
    where: { id: periodId, societyId },
    data: {
      totalBilled: sums._sum.totalAmount ?? new Prisma.Decimal(0),
      totalCollected: sums._sum.paidAmount ?? new Prisma.Decimal(0),
      totalPending: sums._sum.pendingAmount ?? new Prisma.Decimal(0),
    },
  });
}
