import { cleanMonth, collectionRate, readShowCollection, RESIDENT_VISIBLE_PERIOD_STATUSES } from './resident-reports';

describe('resident reports helpers', () => {
  describe('readShowCollection', () => {
    it('is off unless stored as exactly true', () => {
      expect(readShowCollection(undefined)).toBe(false);
      expect(readShowCollection(null)).toBe(false);
      expect(readShowCollection({})).toBe(false);
      expect(readShowCollection({ showCollectionToResidents: 'true' })).toBe(false);
      expect(readShowCollection({ showCollectionToResidents: 1 })).toBe(false);
      expect(readShowCollection({ showCollectionToResidents: false })).toBe(false);
      expect(readShowCollection({ showCollectionToResidents: true })).toBe(true);
    });
  });

  describe('cleanMonth', () => {
    const now = new Date(2026, 10, 12); // 12 Nov 2026
    it('keeps a valid year and month, given as numbers or as the strings a query carries', () => {
      expect(cleanMonth(2026, 9, now)).toEqual({ year: 2026, month: 9 });
      expect(cleanMonth('2025', '12', now)).toEqual({ year: 2025, month: 12 });
    });
    it('falls back to the current month for anything else', () => {
      for (const [y, m] of [[undefined, undefined], ['abc', '3'], [2026, 0], [2026, 13], [2026.5, 3], [1999, 3], [2101, 3], [2026, undefined]]) {
        expect(cleanMonth(y, m, now)).toEqual({ year: 2026, month: 11 });
      }
    });
  });

  describe('collectionRate', () => {
    it('is collected over billed to one decimal place', () => {
      expect(collectionRate(71820.04, 31654.37)).toBe(44.1);
      expect(collectionRate(1000, 1000)).toBe(100);
      expect(collectionRate(3, 1)).toBe(33.3);
    });
    it('is zero when nothing was billed', () => {
      expect(collectionRate(0, 0)).toBe(0);
      expect(collectionRate(-5, 3)).toBe(0);
      expect(collectionRate(NaN, 3)).toBe(0);
    });
  });

  it('never lets a draft or a period still being reviewed through to residents', () => {
    expect(RESIDENT_VISIBLE_PERIOD_STATUSES).not.toContain('DRAFT');
    expect(RESIDENT_VISIBLE_PERIOD_STATUSES).not.toContain('CALCULATED');
    expect(RESIDENT_VISIBLE_PERIOD_STATUSES).not.toContain('REVIEW');
    expect([...RESIDENT_VISIBLE_PERIOD_STATUSES].sort()).toEqual(['CLOSED', 'PAID', 'PARTIALLY_PAID', 'PUBLISHED']);
  });
});
