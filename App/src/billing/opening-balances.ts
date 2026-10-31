import { Prisma } from '@prisma/client';

/**
 * The opening period sorts before every real month, so settlement (oldest first) clears it first and
 * every "earlier periods" arrears query includes it. No real period can use this year: creating one
 * needs a year of 2000 or later.
 */
export const OPENING_PERIOD_YEAR = 1970;
export const OPENING_PERIOD_MONTH = 1;

/** Largest opening balance for one flat: a sane ceiling that catches an extra zero. */
export const MAX_OPENING_AMOUNT = 10_000_000;

export interface OpeningRowInput {
  flatCode: string;
  amount: number;
  note?: string;
}

export interface FlatRef {
  id: string;
  flatCode: string;
}

/** An opening bill already stored for a flat. `locked` is why it can no longer be changed, if it cannot. */
export interface ExistingOpening {
  billId: string;
  flatId: string;
  totalAmount: Prisma.Decimal;
  notes: string | null;
  locked: string | null;
}

export type OpeningAction = 'CREATE' | 'UPDATE' | 'REMOVE' | 'UNCHANGED' | 'REJECTED';

export interface OpeningPlanItem {
  /** 1-based position in the request, so a screen can point at the row. */
  row: number;
  flatCode: string;
  flatId: string | null;
  action: OpeningAction;
  amount: string;
  previous: string | null;
  note: string | null;
  /** Why a row was rejected, or why nothing happens to it. */
  message: string | null;
}

/** "A-101", "a 101" and "A101" are the same flat to the person typing a ledger. */
export function looseFlatKey(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find the flat a row names: an exact (case-insensitive) match first, then a loose one that ignores
 * spaces and dashes — but only when that is unambiguous, because guessing the wrong flat would put a
 * debt on someone who does not owe it.
 */
export function buildFlatMatcher(flats: FlatRef[]): (code: string) => { flat: FlatRef } | { error: string } {
  const exact = new Map<string, FlatRef>();
  const loose = new Map<string, FlatRef[]>();
  for (const f of flats) {
    exact.set(f.flatCode.trim().toLowerCase(), f);
    const key = looseFlatKey(f.flatCode);
    loose.set(key, [...(loose.get(key) ?? []), f]);
  }
  return (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return { error: 'The flat is missing.' };
    const hit = exact.get(trimmed.toLowerCase());
    if (hit) return { flat: hit };
    const candidates = loose.get(looseFlatKey(trimmed)) ?? [];
    if (candidates.length === 1) return { flat: candidates[0] };
    if (candidates.length > 1) {
      return { error: `"${trimmed}" could be ${candidates.map((c) => c.flatCode).join(' or ')}. Use the exact flat code.` };
    }
    return { error: `No flat "${trimmed}" in this society.` };
  };
}

const money = (n: number) => new Prisma.Decimal(n).toDecimalPlaces(2);

/**
 * Decide what each row does, given the flats and the opening bills already stored.
 *
 *   amount > 0, no bill yet        → CREATE
 *   amount > 0, bill, other amount → UPDATE   (only while nothing was paid against it)
 *   amount > 0, bill, same amount  → UNCHANGED
 *   amount = 0, bill               → REMOVE   (only while nothing was paid against it)
 *   amount = 0, no bill            → UNCHANGED
 *
 * A row that names an unknown flat, names a flat twice, or touches a bill that has had a payment is
 * REJECTED with the reason; the rest still go through, as with the flats import.
 */
export function planOpeningBalances(
  rows: OpeningRowInput[],
  flats: FlatRef[],
  existing: ExistingOpening[],
): OpeningPlanItem[] {
  const match = buildFlatMatcher(flats);
  const byFlat = new Map(existing.map((e) => [e.flatId, e]));
  const seen = new Set<string>();

  return rows.map((input, i) => {
    const row = i + 1;
    // A row that gives no note leaves the stored one alone; a blank note clears it.
    const noteGiven = input.note !== undefined;
    let note = input.note?.trim() ? input.note.trim() : null;
    const base = { row, flatCode: input.flatCode.trim(), flatId: null as string | null, amount: '0', previous: null as string | null, note };
    const reject = (message: string, extra: Partial<OpeningPlanItem> = {}): OpeningPlanItem => ({
      ...base, action: 'REJECTED', message, ...extra,
    });

    if (!Number.isFinite(input.amount) || input.amount < 0) return reject('The amount must be zero or more.');
    if (input.amount > MAX_OPENING_AMOUNT) return reject(`That is more than ₹${MAX_OPENING_AMOUNT.toLocaleString('en-IN')} for one flat. Check for an extra zero.`);
    const amount = money(input.amount);

    const found = match(input.flatCode);
    if ('error' in found) return reject(found.error);
    const flat = found.flat;
    const withFlat = { ...base, flatCode: flat.flatCode, flatId: flat.id, amount: amount.toString() };

    if (seen.has(flat.id)) return reject(`${flat.flatCode} is listed more than once.`, { flatCode: flat.flatCode, flatId: flat.id });
    seen.add(flat.id);

    const current = byFlat.get(flat.id);
    const previous = current ? current.totalAmount.toString() : null;
    if (current && !noteGiven) note = current.notes;
    const shown = { ...withFlat, note };

    if (!current) {
      if (amount.isZero()) return { ...shown, action: 'UNCHANGED', previous, message: 'Nothing to record.' };
      return { ...shown, action: 'CREATE', previous, message: null };
    }
    if (current.locked) return { ...shown, action: 'REJECTED', previous, message: current.locked };
    if (amount.isZero()) return { ...shown, action: 'REMOVE', previous, message: null };
    if (amount.equals(current.totalAmount) && note === current.notes) {
      return { ...shown, action: 'UNCHANGED', previous, message: 'Already recorded.' };
    }
    return { ...shown, action: 'UPDATE', previous, message: null };
  });
}

export function summarizePlan(items: OpeningPlanItem[]) {
  const count = (a: OpeningAction) => items.filter((i) => i.action === a).length;
  return {
    created: count('CREATE'),
    updated: count('UPDATE'),
    removed: count('REMOVE'),
    unchanged: count('UNCHANGED'),
    rejected: count('REJECTED'),
  };
}
