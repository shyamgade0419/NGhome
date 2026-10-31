import { Prisma } from '@prisma/client';
import { buildFlatMatcher, ExistingOpening, looseFlatKey, MAX_OPENING_AMOUNT, planOpeningBalances, summarizePlan } from './opening-balances';

const D = (n: number | string) => new Prisma.Decimal(n);
const flats = [
  { id: 'f1', flatCode: 'A-101' },
  { id: 'f2', flatCode: 'A-102' },
  { id: 'f3', flatCode: 'B-201' },
];
const stored = (flatId: string, total: number, over: Partial<ExistingOpening> = {}): ExistingOpening => ({
  billId: `b-${flatId}`, flatId, totalAmount: D(total), notes: null, locked: null, ...over,
});

describe('flat matching', () => {
  it('forgives case, spaces and dashes when only one flat fits', () => {
    const match = buildFlatMatcher(flats);
    expect(match('a-101')).toEqual({ flat: flats[0] });
    expect(match('A 102')).toEqual({ flat: flats[1] });
    expect(match('b201')).toEqual({ flat: flats[2] });
    expect(match('  A-101  ')).toEqual({ flat: flats[0] });
  });

  it('refuses to guess when two flats look alike, but takes an exact code', () => {
    const match = buildFlatMatcher([{ id: 'x', flatCode: 'A-101' }, { id: 'y', flatCode: 'A101' }]);
    expect(match('a 101')).toEqual({ error: expect.stringContaining('could be A-101 or A101') });
    expect(match('A101')).toEqual({ flat: { id: 'y', flatCode: 'A101' } });
    expect(match('A-101')).toEqual({ flat: { id: 'x', flatCode: 'A-101' } });
  });

  it('says so for a flat that does not exist or a blank code', () => {
    const match = buildFlatMatcher(flats);
    expect(match('Z-9')).toEqual({ error: 'No flat "Z-9" in this society.' });
    expect(match('  ')).toEqual({ error: 'The flat is missing.' });
  });

  it('ignores everything but letters and digits for the loose key', () => {
    expect(looseFlatKey(' A - 1/01 ')).toBe('a101');
  });
});

describe('planOpeningBalances', () => {
  it('creates a balance for a flat that has none', () => {
    const [item] = planOpeningBalances([{ flatCode: 'A-101', amount: 12000, note: 'Paper ledger' }], flats, []);
    expect(item).toMatchObject({ row: 1, flatId: 'f1', flatCode: 'A-101', action: 'CREATE', amount: '12000', previous: null, note: 'Paper ledger' });
  });

  it('updates a changed amount, leaves a same one, and removes on zero', () => {
    const plan = planOpeningBalances(
      [{ flatCode: 'A-101', amount: 9000 }, { flatCode: 'A-102', amount: 500 }, { flatCode: 'B-201', amount: 0 }],
      flats,
      [stored('f1', 12000), stored('f2', 500), stored('f3', 300)],
    );
    expect(plan.map((p) => p.action)).toEqual(['UPDATE', 'UNCHANGED', 'REMOVE']);
    expect(plan[0]).toMatchObject({ amount: '9000', previous: '12000' });
  });

  it('does nothing for a zero on a flat with no balance', () => {
    const [item] = planOpeningBalances([{ flatCode: 'A-101', amount: 0 }], flats, []);
    expect(item.action).toBe('UNCHANGED');
  });

  it('refuses to change a balance that has been paid against, and says why', () => {
    const locked = stored('f1', 12000, { locked: 'A payment has been recorded against it, so it can no longer be changed.' });
    const plan = planOpeningBalances([{ flatCode: 'A-101', amount: 8000 }, { flatCode: 'A-101', amount: 0 }], flats, [locked]);
    expect(plan[0]).toMatchObject({ action: 'REJECTED', message: expect.stringContaining('payment has been recorded') });
    // the second row is also a repeat of the same flat
    expect(plan[1].action).toBe('REJECTED');
  });

  it('rejects an unknown flat and a flat listed twice, and still plans the others', () => {
    const plan = planOpeningBalances(
      [{ flatCode: 'A-101', amount: 100 }, { flatCode: 'Z-9', amount: 100 }, { flatCode: 'a 101', amount: 200 }, { flatCode: 'A-102', amount: 300 }],
      flats,
      [],
    );
    expect(plan.map((p) => p.action)).toEqual(['CREATE', 'REJECTED', 'REJECTED', 'CREATE']);
    expect(plan[1].message).toContain('No flat "Z-9"');
    expect(plan[2].message).toBe('A-101 is listed more than once.');
    expect(summarizePlan(plan)).toEqual({ created: 2, updated: 0, removed: 0, unchanged: 0, rejected: 2 });
  });

  it('rejects a negative, absurd or non-finite amount', () => {
    const plan = planOpeningBalances(
      [{ flatCode: 'A-101', amount: -5 }, { flatCode: 'A-102', amount: MAX_OPENING_AMOUNT + 1 }, { flatCode: 'B-201', amount: Number.NaN }],
      flats,
      [],
    );
    expect(plan.every((p) => p.action === 'REJECTED')).toBe(true);
    expect(plan[1].message).toContain('extra zero');
  });

  it('keeps the stored note when a row gives none, and clears it when the note is blank', () => {
    const existing = [stored('f1', 100, { notes: 'Old note' })];
    const keep = planOpeningBalances([{ flatCode: 'A-101', amount: 100 }], flats, existing)[0];
    expect(keep).toMatchObject({ action: 'UNCHANGED', note: 'Old note' });
    const clear = planOpeningBalances([{ flatCode: 'A-101', amount: 100, note: '  ' }], flats, existing)[0];
    expect(clear).toMatchObject({ action: 'UPDATE', note: null });
  });

  it('rounds to paise', () => {
    const [item] = planOpeningBalances([{ flatCode: 'A-101', amount: 100.456 }], flats, []);
    expect(item.amount).toBe('100.46');
  });
});
