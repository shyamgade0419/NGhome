/**
 * Closing a month closes its books: an expense dated in a closed month, or in any month before one, cannot be added or
 * changed. The server decides and marks each expense `locked`; this is how the page tells the admin, and stops them
 * choosing a date that is certain to be refused. Months are calendar months in Indian time, as on the server.
 */

export interface YearMonth { year: number; month: number }
export type LockedThrough = YearMonth | null | undefined;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthTitle = ({ year, month }: YearMonth): string => `${MONTH_NAMES[month - 1] ?? ''} ${year}`.trim();

/** The month, in Indian time, that a date (or date text such as '2026-10-12') falls in. */
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

/** 'YYYY-MM' (what a month input holds) to a year and month, or null when it is empty or unreadable. */
export function parseMonthInput(value: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

/** This month as 'YYYY-MM', in Indian time. */
export function thisMonthInput(now: Date = new Date()): string {
  const { year, month } = monthOfDate(now)!;
  return `${year}-${String(month).padStart(2, '0')}`;
}
