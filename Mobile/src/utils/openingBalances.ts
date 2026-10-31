/** Opening balances: the dues a flat carried over from paper or Excel. See the API's billing/opening-balances. */

export interface OpeningRow {
  flatId: string;
  flatCode: string;
  residentName: string | null;
  /** The opening balance, or null when the flat has none. */
  amount: string | null;
  paidAmount: string;
  pendingAmount: string;
  note: string | null;
  /** Why it can no longer be changed, or null. */
  locked: string | null;
}

export interface OpeningBalances {
  asOfDate: string | null;
  /** True once a month has been billed: opening dues are then added to bills people already saw. */
  startedBilling: boolean;
  totals: { flats: number; withBalance: number; opening: string; paid: string; pending: string };
  rows: OpeningRow[];
}

export interface OpeningPlanItem {
  row: number;
  flatCode: string;
  flatId: string | null;
  action: 'CREATE' | 'UPDATE' | 'REMOVE' | 'UNCHANGED' | 'REJECTED';
  amount: string;
  previous: string | null;
  note: string | null;
  message: string | null;
}

export interface OpeningSaveResult {
  dryRun: boolean;
  asOfDate: string;
  summary: { created: number; updated: number; removed: number; unchanged: number; rejected: number };
  results: OpeningPlanItem[];
}

/**
 * An amount as a person types it: "12,000", "₹ 12000.50", "Rs. 800". Blank means none.
 * Returns the number, null for blank, or NaN for something that is not an amount.
 */
export function parseMoney(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const cleaned = text.replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Math.round(parseFloat(cleaned) * 100) / 100;
}

/** The flats a search matches: by flat code or resident name. */
export function filterOpeningRows(rows: OpeningRow[], search: string, onlyWithBalance: boolean): OpeningRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (onlyWithBalance && r.amount === null) return false;
    return !q || r.flatCode.toLowerCase().includes(q) || (r.residentName ?? '').toLowerCase().includes(q);
  });
}

/** What the server was told about a save, as one sentence for an alert. */
export function saveMessage(res: OpeningSaveResult): string {
  const s = res.summary;
  const done = s.created + s.updated + s.removed;
  const parts = [done === 0 ? 'Nothing needed saving.' : `Saved for ${done} flat${done === 1 ? '' : 's'}.`];
  const problems = res.results.filter((r) => r.action === 'REJECTED');
  for (const p of problems) parts.push(`${p.flatCode || 'Row ' + p.row}: ${p.message}`);
  return parts.join('\n');
}

/** The date as yyyy-mm-dd, in the device's own day (not UTC, which can be yesterday). */
export function isoDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
