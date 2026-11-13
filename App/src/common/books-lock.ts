/**
 * Closing a month closes its books. Once a billing month is closed, every expense dated in that month, or in any month
 * before it, and every salary for such a month, is part of what was closed: it cannot be added, changed, approved,
 * rejected, paid or deleted. Closing a month therefore closes the earlier ones with it, even if they were never closed one
 * by one.
 *
 * Months are the society's calendar months in Indian time, so an expense dated late on the 31st or early on the 1st lands
 * in the month it was meant for whichever way the date was stored.
 */
import { PrismaService } from '../prisma/prisma.service';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface YearMonth { year: number; month: number }

/** A comparable number for a month: later months are larger. */
export const keyOf = (year: number, month: number): number => year * 12 + (month - 1);

/** The month, in Indian time, that a date falls in. */
export function monthOfDate(date: Date): YearMonth {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

export const monthKey = (date: Date): number => {
  const { year, month } = monthOfDate(date);
  return keyOf(year, month);
};

export const monthTitle = ({ year, month }: YearMonth): string => `${MONTH_NAMES[month - 1] ?? ''} ${year}`.trim();

export interface ExpenseLock {
  /** The latest closed month, or null when no month has been closed. */
  through: YearMonth | null;
}

export const NO_LOCK: ExpenseLock = { through: null };

/** Whether an expense with this date is in a closed month, or before one. */
export function isLocked(date: Date, lock: ExpenseLock): boolean {
  return lock.through !== null && monthKey(date) <= keyOf(lock.through.year, lock.through.month);
}

/** The latest of the closed months given, or null for none. */
export function latestClosed(periods: Array<{ periodYear: number; periodMonth: number }>): YearMonth | null {
  let best: YearMonth | null = null;
  for (const p of periods) {
    if (best === null || keyOf(p.periodYear, p.periodMonth) > keyOf(best.year, best.month)) best = { year: p.periodYear, month: p.periodMonth };
  }
  return best;
}

/** Whether a month (a salary is kept by month, not by date) is closed, or before a closed one. */
export function isMonthLocked(year: number, month: number, lock: ExpenseLock): boolean {
  return lock.through !== null && keyOf(year, month) <= keyOf(lock.through.year, lock.through.month);
}

/** What the admin is told when they try to touch a closed month. `what` is the thing that was refused. */
export function lockMessage(lock: ExpenseLock, what: 'expense' | 'salary' = 'expense'): string {
  const thing = what === 'salary' ? 'a salary for then or an earlier month' : 'an expense dated then or earlier';
  return lock.through
    ? `The books are closed up to ${monthTitle(lock.through)}, so ${thing} cannot be added or changed.`
    : `This ${what} is in a closed month and cannot be changed.`;
}

/**
 * The society's lock: its latest closed billing month. The opening period (dues carried over) is not a month of its own and
 * never locks anything.
 */
export async function loadExpenseLock(prisma: Pick<PrismaService, 'billingPeriod'>, societyId: string): Promise<ExpenseLock> {
  const closed = await prisma.billingPeriod.findMany({
    where: { societyId, kind: 'REGULAR', status: 'CLOSED' },
    select: { periodYear: true, periodMonth: true },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    take: 1,
  });
  return { through: latestClosed(closed) };
}

/** A month taken from a query string: both a year and a month that make sense, else null (no month filter). */
export function parseMonth(year: unknown, month: unknown): YearMonth | null {
  const y = Number(year);
  const m = Number(month);
  return Number.isInteger(y) && Number.isInteger(m) && y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? { year: y, month: m } : null;
}

/** The dates that fall in a month in Indian time, from its first instant up to (not including) the next month's. */
export function monthRange({ year, month }: YearMonth): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS),
    lt: new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS),
  };
}
