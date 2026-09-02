/**
 * Safe numeric formatting for API values.
 *
 * The API is not consistent about how it serializes money. Prisma Decimals
 * reach us as strings (Decimal.prototype.toJSON is patched to .toString()),
 * but several endpoints call .toNumber() first and send real numbers —
 * /reports/outstanding-dues and /reports/expense-summary send numbers while
 * /reports/collection-summary sends strings, for example. Fields can also be
 * absent entirely when a society has no data yet.
 *
 * Rendering those directly is what produced "₹NaN" on real devices: an
 * undefined field flows into arithmetic, and NaN.toLocaleString() prints
 * literally as "NaN". These helpers coerce defensively so a missing value
 * renders as zero rather than leaking NaN into the UI.
 */

/** Coerce any API numeric (number | decimal string | null | undefined) to a number. Never returns NaN. */
export function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Format an API numeric as Indian rupees. Missing or malformed values render as ₹0. */
export function inr(value: unknown, opts?: { decimals?: boolean }): string {
  const n = toNum(value);
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

/** Compact rupees for tight summary tiles: ₹1.2L, ₹45.0K, ₹900. */
export function inrCompact(value: unknown): string {
  const n = toNum(value);
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

/** Sum an API numeric field across rows without risking NaN. */
export function sumBy<T>(rows: T[], pick: (row: T) => unknown): number {
  return (rows ?? []).reduce((total, row) => total + toNum(pick(row)), 0);
}
