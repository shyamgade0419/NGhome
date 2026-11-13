import {
  NO_LOCK,
  isLocked,
  keyOf,
  latestClosed,
  loadExpenseLock,
  lockMessage,
  monthKey,
  monthOfDate,
  monthRange,
  monthTitle,
  parseMonth,
} from './expense-lock';

const closedThrough = (year: number, month: number) => ({ through: { year, month } });

describe('expense lock', () => {
  describe('months in Indian time', () => {
    it('puts a date in the month it falls in for the society, however it was stored', () => {
      // Stored as midnight UTC on the 31st (5:30 am in India): still October.
      expect(monthOfDate(new Date('2026-10-31T00:00:00Z'))).toEqual({ year: 2026, month: 10 });
      // Stored as midnight India time on 1 November (6:30 pm UTC on the 31st): November.
      expect(monthOfDate(new Date('2026-10-31T18:30:00Z'))).toEqual({ year: 2026, month: 11 });
      // Last minute of October in India.
      expect(monthOfDate(new Date('2026-10-31T18:29:59Z'))).toEqual({ year: 2026, month: 10 });
    });
    it('rolls over the year in Indian time', () => {
      expect(monthOfDate(new Date('2026-12-31T19:00:00Z'))).toEqual({ year: 2027, month: 1 });
    });
    it('orders months, across years', () => {
      expect(keyOf(2026, 12)).toBeLessThan(keyOf(2027, 1));
      expect(keyOf(2026, 1)).toBeLessThan(keyOf(2026, 2));
      expect(monthKey(new Date('2026-03-15T00:00:00Z'))).toBe(keyOf(2026, 3));
    });
  });

  describe('isLocked', () => {
    const oct = closedThrough(2026, 10);
    it('locks the closed month and every month before it, even ones never closed on their own', () => {
      expect(isLocked(new Date('2026-10-15T00:00:00Z'), oct)).toBe(true);
      expect(isLocked(new Date('2026-09-30T00:00:00Z'), oct)).toBe(true);
      expect(isLocked(new Date('2025-01-05T00:00:00Z'), oct)).toBe(true);
    });
    it('leaves the month after, and later, open', () => {
      expect(isLocked(new Date('2026-11-01T06:00:00Z'), oct)).toBe(false);
      expect(isLocked(new Date('2027-02-01T00:00:00Z'), oct)).toBe(false);
    });
    it('draws the line at midnight in India, not in UTC', () => {
      expect(isLocked(new Date('2026-10-31T18:29:00Z'), oct)).toBe(true); // 11:59 pm on 31 Oct in India
      expect(isLocked(new Date('2026-10-31T18:31:00Z'), oct)).toBe(false); // 12:01 am on 1 Nov in India
    });
    it('locks nothing when no month has been closed', () => {
      expect(isLocked(new Date('2020-01-01T00:00:00Z'), NO_LOCK)).toBe(false);
    });
  });

  describe('latestClosed', () => {
    it('is the latest month, wherever it sits in the list and across years', () => {
      expect(latestClosed([{ periodYear: 2026, periodMonth: 3 }, { periodYear: 2026, periodMonth: 10 }, { periodYear: 2025, periodMonth: 12 }])).toEqual({ year: 2026, month: 10 });
      expect(latestClosed([{ periodYear: 2026, periodMonth: 1 }, { periodYear: 2025, periodMonth: 12 }])).toEqual({ year: 2026, month: 1 });
    });
    it('is null for none', () => {
      expect(latestClosed([])).toBeNull();
    });
  });

  describe('loadExpenseLock', () => {
    it('asks for the latest closed regular month of this society only', async () => {
      const findMany = jest.fn().mockResolvedValue([{ periodYear: 2026, periodMonth: 10 }]);
      const lock = await loadExpenseLock({ billingPeriod: { findMany } } as never, 'soc-1');
      expect(lock).toEqual({ through: { year: 2026, month: 10 } });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { societyId: 'soc-1', kind: 'REGULAR', status: 'CLOSED' },
        take: 1,
      }));
    });
    it('is no lock when nothing is closed', async () => {
      const lock = await loadExpenseLock({ billingPeriod: { findMany: jest.fn().mockResolvedValue([]) } } as never, 'soc-1');
      expect(lock).toEqual(NO_LOCK);
    });
  });

  describe('wording', () => {
    it('names the month the books are closed up to', () => {
      expect(lockMessage(closedThrough(2026, 10))).toContain('October 2026');
      expect(lockMessage(closedThrough(2026, 10))).toMatch(/cannot be added or changed/);
      expect(monthTitle({ year: 2026, month: 3 })).toBe('March 2026');
    });
  });

  describe('month filter', () => {
    it('accepts a year and month that make sense and nothing else', () => {
      expect(parseMonth('2026', '10')).toEqual({ year: 2026, month: 10 });
      expect(parseMonth(2026, 1)).toEqual({ year: 2026, month: 1 });
      for (const [y, m] of [[undefined, undefined], ['2026', undefined], [undefined, '5'], ['abc', '5'], [2026, 0], [2026, 13], [1999, 5], [2026.5, 5]]) {
        expect(parseMonth(y, m)).toBeNull();
      }
    });
    it('covers the whole of a month in India time and none of the next', () => {
      const r = monthRange({ year: 2026, month: 10 });
      expect(r.gte.toISOString()).toBe('2026-09-30T18:30:00.000Z');
      expect(r.lt.toISOString()).toBe('2026-10-31T18:30:00.000Z');
      expect(monthRange({ year: 2026, month: 12 }).lt.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    });
    it('puts the same dates in a month that isLocked does', () => {
      const r = monthRange({ year: 2026, month: 10 });
      for (const iso of ['2026-09-30T18:30:00Z', '2026-10-15T00:00:00Z', '2026-10-31T18:29:00Z']) {
        const d = new Date(iso);
        expect(d >= r.gte && d < r.lt).toBe(true);
        expect(monthOfDate(d)).toEqual({ year: 2026, month: 10 });
      }
      for (const iso of ['2026-09-30T18:29:00Z', '2026-10-31T18:30:00Z']) {
        const d = new Date(iso);
        expect(d >= r.gte && d < r.lt).toBe(false);
      }
    });
  });
});
