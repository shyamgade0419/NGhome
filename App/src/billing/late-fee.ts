/**
 * The fine on a bill paid after its due date.
 *
 * The society sets it once (Settings → Billing): a fixed amount or a percentage, how many days of
 * grace, and an optional cap. A bill is fined once, the day after the due date plus the grace days
 * have passed, if anything on it is still unpaid. A percentage is of what is still unpaid on that
 * month's bill — not of earlier months' arrears, which were fined in their own month.
 */

import { Prisma } from '@prisma/client';
import { istDateString } from '../amenities/amenity-time';

export interface LateFeeSettings {
  lateFeeType: string | null;
  lateFeeValue: Prisma.Decimal | null;
  lateFeeMaxAmount: Prisma.Decimal | null;
  gracePeriodDays: number;
}

/** Whether the society has a fine switched on at all. */
export function lateFeeEnabled(s: Pick<LateFeeSettings, 'lateFeeType' | 'lateFeeValue'>): boolean {
  const type = (s.lateFeeType ?? '').toUpperCase();
  return (type === 'FIXED' || type === 'PERCENTAGE') && !!s.lateFeeValue && s.lateFeeValue.greaterThan(0);
}

/** The fine for a bill with this much still unpaid; zero when there is none to charge. */
export function lateFeeAmount(s: LateFeeSettings, unpaid: Prisma.Decimal): Prisma.Decimal {
  if (!lateFeeEnabled(s) || !s.lateFeeValue || unpaid.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
  let fee = (s.lateFeeType ?? '').toUpperCase() === 'PERCENTAGE' ? unpaid.mul(s.lateFeeValue).div(100) : s.lateFeeValue;
  if (s.lateFeeMaxAmount && s.lateFeeMaxAmount.greaterThan(0) && fee.greaterThan(s.lateFeeMaxAmount)) {
    fee = s.lateFeeMaxAmount;
  }
  return fee.toDecimalPlaces(2);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The last day (YYYY-MM-DD) a bill can be paid without a fine: the due date plus the grace days. */
export function lastFreeDay(dueDate: Date, graceDays: number): string {
  // Due dates are calendar dates stored at UTC midnight; read them as the date they name.
  const day = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));
  return new Date(day.getTime() + Math.max(0, graceDays) * DAY_MS).toISOString().slice(0, 10);
}

/** Fined from the day after the last free day, by the India calendar. */
export function isOverdue(dueDate: Date, graceDays: number, now: Date): boolean {
  return istDateString(now) > lastFreeDay(dueDate, graceDays);
}

/**
 * The due date at or before which a bill is overdue right now — the cut-off to query by.
 * A bill whose due date is on or before this has its last free day already past.
 */
export function overdueDueDateCutoff(graceDays: number, now: Date): Date {
  const [y, m, d] = istDateString(now).split('-').map(Number);
  // Today (India) minus the grace days minus one: a due date of that day has its last free day = yesterday.
  return new Date(Date.UTC(y, m - 1, d) - (Math.max(0, graceDays) + 1) * DAY_MS);
}
