/** Opening balances: the dues a flat carried over from paper or Excel. See the API's billing/opening-balances. */

export type OpeningAction = 'CREATE' | 'UPDATE' | 'REMOVE' | 'UNCHANGED' | 'REJECTED';

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
  action: OpeningAction;
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

export interface OpeningInputRow {
  flatCode: string;
  amount: number;
  note?: string;
}

/**
 * An amount as a person types it in a ledger: "12,000", "₹ 12000.50", "Rs. 800". Blank means no dues.
 * Returns the number, null for blank, or NaN for something that is not an amount.
 */
export function parseMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : Number.NaN;
  const text = String(raw).trim();
  if (text === '' || text === '-' || text === '—') return null;
  const cleaned = text.replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Math.round(parseFloat(cleaned) * 100) / 100;
}

const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const FLAT_HEADERS = ['flat', 'flatcode', 'flatno', 'flatnumber', 'unit', 'unitnumber', 'house', 'houseno'];
const AMOUNT_HEADERS = ['amount', 'openingbalance', 'balance', 'dues', 'due', 'arrears', 'outstanding', 'pending', 'openingdues'];
const NOTE_HEADERS = ['note', 'notes', 'remarks', 'remark', 'narration', 'comment', 'comments'];

export interface ParsedLine {
  /** Row number in the file, counting the header as row 1. */
  line: number;
  flatCode: string;
  amount: number | null;
  note: string;
  error: string | null;
}

/** Read the rows of a sheet, forgiving how the columns are named. A row with no amount (no dues) is skipped. */
export function parseOpeningSheet(records: Record<string, unknown>[]): { lines: ParsedLine[]; missing: string | null } {
  if (records.length === 0) return { lines: [], missing: 'The file has no rows.' };
  const headers = Object.keys(records[0]);
  const pick = (names: string[]) => headers.find((h) => names.includes(key(h)));
  const flatCol = pick(FLAT_HEADERS);
  const amountCol = pick(AMOUNT_HEADERS);
  const noteCol = pick(NOTE_HEADERS);
  if (!flatCol) return { lines: [], missing: 'There is no Flat column. Name the first column "Flat".' };
  if (!amountCol) return { lines: [], missing: 'There is no Amount column. Name the amount column "Amount".' };

  const lines: ParsedLine[] = [];
  records.forEach((rec, i) => {
    const flatCode = String(rec[flatCol] ?? '').trim();
    const amount = parseMoney(rec[amountCol]);
    const note = noteCol ? String(rec[noteCol] ?? '').trim() : '';
    if (!flatCode && amount === null) return; // an empty row
    const line = i + 2;
    if (amount === null) return; // no dues for this flat
    if (!flatCode) {
      lines.push({ line, flatCode, amount: null, note, error: 'The flat is missing.' });
    } else if (Number.isNaN(amount)) {
      lines.push({ line, flatCode, amount: null, note, error: `"${String(rec[amountCol])}" is not an amount.` });
    } else {
      lines.push({ line, flatCode, amount, note, error: null });
    }
  });
  return { lines, missing: null };
}
