import { OpeningRow, OpeningSaveResult, filterOpeningRows, isoDay, parseMoney, saveMessage } from '@/utils/openingBalances';

const row = (over: Partial<OpeningRow> = {}): OpeningRow => ({
  flatId: 'f1', flatCode: 'A-101', residentName: 'Arjun Mehta', amount: null, paidAmount: '0', pendingAmount: '0', note: null, locked: null, ...over,
});

describe('reading an amount as typed', () => {
  it('takes plain and ledger-style amounts', () => {
    expect(parseMoney('12000')).toBe(12000);
    expect(parseMoney('12,000')).toBe(12000);
    expect(parseMoney('₹ 12,000.50')).toBe(12000.5);
    expect(parseMoney('Rs. 800')).toBe(800);
    expect(parseMoney('  45 ')).toBe(45);
  });

  it('treats blank as none and rounds to paise', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney('100.456')).toBe(100.46);
  });

  it('refuses anything that is not an amount, including negatives', () => {
    expect(parseMoney('abc')).toBeNaN();
    expect(parseMoney('-5')).toBeNaN();
    expect(parseMoney('12k')).toBeNaN();
    expect(parseMoney('1.2.3')).toBeNaN();
  });
});

describe('finding a flat', () => {
  const rows = [row(), row({ flatId: 'f2', flatCode: 'B-201', residentName: 'Kavya Reddy', amount: '500' })];

  it('matches the flat code or the resident, ignoring case', () => {
    expect(filterOpeningRows(rows, 'b-2', false).map((r) => r.flatCode)).toEqual(['B-201']);
    expect(filterOpeningRows(rows, 'ARJUN', false).map((r) => r.flatCode)).toEqual(['A-101']);
    expect(filterOpeningRows(rows, '', false)).toHaveLength(2);
  });

  it('can show only the flats that have a balance', () => {
    expect(filterOpeningRows(rows, '', true).map((r) => r.flatCode)).toEqual(['B-201']);
  });
});

describe('what a save says', () => {
  const result = (over: Partial<OpeningSaveResult>): OpeningSaveResult => ({
    dryRun: false, asOfDate: '2026-03-31', summary: { created: 0, updated: 0, removed: 0, unchanged: 0, rejected: 0 }, results: [], ...over,
  });

  it('counts what was saved', () => {
    expect(saveMessage(result({ summary: { created: 1, updated: 0, removed: 0, unchanged: 0, rejected: 0 } }))).toBe('Saved for 1 flat.');
    expect(saveMessage(result({ summary: { created: 2, updated: 1, removed: 0, unchanged: 0, rejected: 0 } }))).toBe('Saved for 3 flats.');
    expect(saveMessage(result({}))).toBe('Nothing needed saving.');
  });

  it('gives the reason a flat was refused', () => {
    const msg = saveMessage(
      result({
        summary: { created: 0, updated: 0, removed: 0, unchanged: 0, rejected: 1 },
        results: [{ row: 1, flatCode: 'A-101', flatId: 'f1', action: 'REJECTED', amount: '0', previous: '900', note: null, message: 'A payment has been recorded against it, so it can no longer be changed.' }],
      }),
    );
    expect(msg).toContain('A-101: A payment has been recorded');
  });
});

describe('the as-of date', () => {
  it("is the device's own day, not UTC", () => {
    // 23:30 on 31 March in India is already 1 April in UTC+5:30's next-day UTC conversion only the other way round;
    // what matters is that the local date is used as it stands.
    expect(isoDay(new Date(2026, 2, 31, 23, 30))).toBe('2026-03-31');
    expect(isoDay(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
  });
});
