/**
 * What a flat owes. Payments are settled oldest month first, so the amount to pay is everything owed on
 * the flat's published bills — this month's and any earlier month still unpaid — not this month alone.
 */

import { toNum } from '@/utils/format';

interface BillLike {
  pendingAmount: string | number;
  isPaid?: boolean;
  isPublished?: boolean;
}

/** Everything still owed on published bills. */
export function totalDue(bills: BillLike[]): number {
  return Math.round(
    bills
      .filter((b) => b.isPublished !== false && !b.isPaid)
      .reduce((sum, b) => sum + Math.max(0, toNum(b.pendingAmount)), 0) * 100,
  ) / 100;
}

/** The part of what is owed that is not this month's bill — arrears carried forward. */
export function earlierDue(total: number, thisMonthPending: string | number | undefined): number {
  return Math.max(0, Math.round((total - toNum(thisMonthPending ?? 0)) * 100) / 100);
}
