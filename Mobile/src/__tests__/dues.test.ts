import { earlierDue, totalDue } from '@/utils/dues';

describe('what a flat owes', () => {
  it('adds up everything unpaid on published bills', () => {
    expect(totalDue([{ pendingAmount: '1000' }, { pendingAmount: '500.50' }, { pendingAmount: 0, isPaid: true }])).toBe(1500.5);
  });

  it('ignores bills not published yet and bills already paid', () => {
    expect(totalDue([{ pendingAmount: '900', isPublished: false }, { pendingAmount: '100', isPaid: true }, { pendingAmount: '40' }])).toBe(40);
  });

  it('is zero with no bills, and never negative', () => {
    expect(totalDue([])).toBe(0);
    expect(totalDue([{ pendingAmount: -5 }])).toBe(0);
  });

  it('keeps paise exact', () => {
    expect(totalDue([{ pendingAmount: '0.1' }, { pendingAmount: '0.2' }])).toBe(0.3);
  });

  it('works out what is carried forward from earlier months', () => {
    expect(earlierDue(2500, '1000')).toBe(1500);
    expect(earlierDue(1000, '1000')).toBe(0);
    expect(earlierDue(800, '1000')).toBe(0);
    expect(earlierDue(1000, undefined)).toBe(1000);
  });
});
