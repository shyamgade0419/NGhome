import { describeDiscount, monthEnd, monthStart, parseMonth } from '@/utils/flatDiscounts';

describe('describing a discount', () => {
  it('reads as rupees or a percentage', () => {
    expect(describeDiscount('FIXED', '500')).toBe('₹500 off');
    expect(describeDiscount('FIXED', 12500)).toBe('₹12,500 off');
    expect(describeDiscount('PERCENT', '10')).toBe('10% off');
    expect(describeDiscount('PERCENT', '7.5')).toBe('7.5% off');
  });
});

describe('the months a discount runs for', () => {
  it('starts on the first day and ends on the last, leap years included', () => {
    expect(monthStart('2026-04')).toBe('2026-04-01');
    expect(monthEnd('2026-04')).toBe('2026-04-30');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2027-02')).toBe('2027-02-28');
  });

  it('reads a month however it is typed', () => {
    expect(parseMonth('2026-04')).toBe('2026-04');
    expect(parseMonth('2026-4')).toBe('2026-04');
    expect(parseMonth('4/2026')).toBe('2026-04');
    expect(parseMonth(' 04-2026 ')).toBe('2026-04');
  });

  it('refuses what is not a month', () => {
    expect(parseMonth('')).toBeNull();
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
    expect(parseMonth('April')).toBeNull();
    expect(parseMonth('26-04')).toBeNull();
  });
});
