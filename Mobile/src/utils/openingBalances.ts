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

// ── Loading a file of balances ──────────────────────────────────────────────

/** One row read from a file. `line` counts the header as line 1, so it matches what the person sees in Excel. */
export interface ParsedLine {
  line: number;
  flatCode: string;
  amount: number | null;
  note: string;
  error: string | null;
}

/** Split CSV text into rows of cells: quoted cells, doubled quotes, a BOM, and \r\n or \n line ends. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // a UTF-8 byte-order mark, as Excel writes
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  // Excel in some locales saves with semicolons, and "Text (Tab delimited)" with tabs.
  const delim = firstLine.includes(',') ? ',' : firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const FLAT_HEADERS = ['flat', 'flatcode', 'flatno', 'flatnumber', 'unit', 'unitnumber', 'house', 'houseno'];
const AMOUNT_HEADERS = ['amount', 'openingbalance', 'balance', 'dues', 'due', 'arrears', 'outstanding', 'pending', 'openingdues'];
const NOTE_HEADERS = ['note', 'notes', 'remarks', 'remark', 'narration', 'comment', 'comments'];

/**
 * Read a CSV of opening balances, forgiving how the columns are named. A row with no amount (no dues) is
 * skipped. `missing` says why nothing could be read when the columns are not there.
 */
export function parseOpeningCsv(text: string): { lines: ParsedLine[]; missing: string | null } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { lines: [], missing: 'The file has no rows.' };
  const head = rows[0].map(norm);
  const flatCol = head.findIndex((h) => FLAT_HEADERS.includes(h));
  const amountCol = head.findIndex((h) => AMOUNT_HEADERS.includes(h));
  const noteCol = head.findIndex((h) => NOTE_HEADERS.includes(h));
  if (flatCol < 0) return { lines: [], missing: 'There is no Flat column. Name the first column "Flat".' };
  if (amountCol < 0) return { lines: [], missing: 'There is no Amount column. Name the amount column "Amount".' };

  const lines: ParsedLine[] = [];
  rows.slice(1).forEach((r, i) => {
    const flatCode = (r[flatCol] ?? '').trim();
    const rawAmount = r[amountCol] ?? '';
    const amount = parseMoney(rawAmount);
    const note = noteCol >= 0 ? (r[noteCol] ?? '').trim() : '';
    if (amount === null) return; // no dues for this flat
    const line = i + 2;
    if (!flatCode) lines.push({ line, flatCode, amount: null, note, error: 'The flat is missing.' });
    else if (Number.isNaN(amount)) lines.push({ line, flatCode, amount: null, note, error: `"${rawAmount.trim()}" is not an amount.` });
    else lines.push({ line, flatCode, amount, note, error: null });
  });
  return { lines, missing: null };
}
