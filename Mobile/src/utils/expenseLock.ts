/**
 * Closing a month closes its books: an expense dated in a closed month, or in any month before one, cannot be added or
 * changed. The server decides and marks each expense `locked`; this is how the app tells the admin, and stops them
 * typing a date that is certain to be refused.
 *
 * Months are the society's calendar months in Indian time, the same as the server's.
 */
import { monthTitle, type YearMonth } from '@/reports/residentReports';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type LockedThrough = YearMonth | null | undefined;

/** The month, in Indian time, that a date (or an ISO date text such as '2026-10-12') falls in. */
export function monthOfDate(date: string | Date): YearMonth | null {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

const keyOf = ({ year, month }: YearMonth) => year * 12 + (month - 1);

/** Whether a date is in the closed months (the latest closed month and everything before it). */
export function isLockedDate(date: string | Date, through: LockedThrough): boolean {
  if (!through) return false;
  const m = monthOfDate(date);
  return m !== null && keyOf(m) <= keyOf(through);
}

/** Whether a month (a salary is kept by month, not by date) is in the closed months. */
export function isLockedMonth(year: number, month: number, through: LockedThrough): boolean {
  return !!through && keyOf({ year, month }) <= keyOf(through);
}

/** The line shown above the list: how far the books are closed. Null when no month is closed. */
export function lockNotice(through: LockedThrough, what: 'expense' | 'salary' = 'expense'): string | null {
  if (!through) return null;
  const rest = what === 'salary' ? 'Salaries for then or earlier months cannot be processed or paid.' : 'Expenses up to then cannot be added or changed.';
  return `Books are closed up to ${monthTitle(through)}. ${rest}`;
}
