/**
 * Helpers for the society-wide reports a resident can read (collection summary, expense breakdown). The figures are
 * worked out in SocietiesService; this file holds the small pure parts so they can be tested on their own.
 */

/** A billing period a resident may be shown: one that has been published to flats, never a draft still being worked on. */
export const RESIDENT_VISIBLE_PERIOD_STATUSES = ['PUBLISHED', 'PARTIALLY_PAID', 'PAID', 'CLOSED'] as const;

/** Whether the society has switched the collection summary on for residents. Off unless stored as exactly `true`. */
export function readShowCollection(additionalConfig: unknown): boolean {
  return (additionalConfig as { showCollectionToResidents?: unknown } | null | undefined)?.showCollectionToResidents === true;
}

/**
 * A year and month taken from a query string. Anything that is not a whole year (2000 to 2100) and month (1 to 12)
 * falls back to the current month, so a bad query still answers instead of failing.
 */
export function cleanMonth(year: unknown, month: unknown, now: Date = new Date()): { year: number; month: number } {
  const y = Number(year);
  const m = Number(month);
  const ok = Number.isInteger(y) && Number.isInteger(m) && y >= 2000 && y <= 2100 && m >= 1 && m <= 12;
  return ok ? { year: y, month: m } : { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Collected as a share of billed, to one decimal place, e.g. 44.1. Zero when nothing was billed. */
export function collectionRate(billed: number, collected: number): number {
  if (!(billed > 0)) return 0;
  return Math.round((collected / billed) * 1000) / 10;
}
