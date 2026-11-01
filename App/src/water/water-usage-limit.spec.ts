import { Prisma } from '@prisma/client';
import { describeUsageLimit, readUsageLimit, validateUsageLimit, waterCharge, type UsageLimit } from './water-usage-limit';

const pct = (value: number, limitUnits = 20): UsageLimit => ({ limitUnits, mode: 'PERCENT', value });
const perUnit = (value: number, limitUnits = 20): UsageLimit => ({ limitUnits, mode: 'PER_UNIT', value });
const oneTime = (value: number, limitUnits = 20): UsageLimit => ({ limitUnits, mode: 'ONE_TIME', value });

describe('waterCharge', () => {
  it('is just units × rate when there is no limit', () => {
    const c = waterCharge(26, 50, null);
    expect(c.total.toFixed(2)).toBe('1300.00');
    expect(c.excessUnits.isZero()).toBe(true);
    expect(c.excessCharge.isZero()).toBe(true);
    expect(c.excessRate).toBeNull();
  });

  it('changes nothing for a flat within the limit, or exactly on it', () => {
    for (const limit of [pct(50), perUnit(10), oneTime(500)]) {
      const within = waterCharge(12, 50, limit);
      expect(within.total.toFixed(2)).toBe('600.00');
      expect(within.excessUnits.isZero()).toBe(true);
      const on = waterCharge(20, 50, limit);
      expect(on.total.toFixed(2)).toBe('1000.00');
      expect(on.excessCharge.isZero()).toBe(true);
    }
  });

  it('keeps the first 20 units at the normal rate and charges a percentage more on the rest', () => {
    // 26 units at ₹50: 20 × 50 = 1000, and 6 × (50 + 25%) = 6 × 62.5 = 375
    const c = waterCharge(26, 50, pct(25));
    expect(c.baseCharge.toFixed(2)).toBe('1300.00');
    expect(c.excessUnits.toFixed(3)).toBe('6.000');
    expect(c.excessRate!.toFixed(2)).toBe('62.50');
    expect(c.excessCharge.toFixed(2)).toBe('75.00');
    expect(c.total.toFixed(2)).toBe('1375.00');
  });

  it('adds a fixed rupee amount per unit above the limit', () => {
    // 26 units at ₹50 plus ₹10 for each of the 6 above 20
    const c = waterCharge(26, 50, perUnit(10));
    expect(c.excessRate!.toFixed(2)).toBe('60.00');
    expect(c.excessCharge.toFixed(2)).toBe('60.00');
    expect(c.total.toFixed(2)).toBe('1360.00');
  });

  it('charges a one-time fee once, however far past the limit', () => {
    expect(waterCharge(21, 50, oneTime(500)).total.toFixed(2)).toBe('1550.00');
    expect(waterCharge(60, 50, oneTime(500)).total.toFixed(2)).toBe('3500.00');
    expect(waterCharge(60, 50, oneTime(500)).excessRate).toBeNull();
    expect(waterCharge(60, 50, oneTime(500)).excessUnits.toFixed(3)).toBe('40.000');
  });

  it('works with fractions of a unit', () => {
    // 20.5 units at ₹40 with 50% more: 0.5 × 20 extra = 10
    const c = waterCharge(20.5, 40, pct(50));
    expect(c.excessUnits.toFixed(3)).toBe('0.500');
    expect(c.excessCharge.toFixed(2)).toBe('10.00');
    expect(c.total.toFixed(2)).toBe('830.00');
  });

  it('rounds the total to the paisa', () => {
    const c = waterCharge(23.333, 37.7777, pct(15));
    expect(c.total.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(c.excessCharge.decimalPlaces()).toBeLessThanOrEqual(2);
  });

  it('a 0% or ₹0 extra changes nothing', () => {
    expect(waterCharge(30, 50, pct(0)).total.toFixed(2)).toBe('1500.00');
    expect(waterCharge(30, 50, perUnit(0)).total.toFixed(2)).toBe('1500.00');
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 style trap: 30 units at ₹0.1 with ₹0.2 more per unit above 20
    const c = waterCharge(30, 0.1, perUnit(0.2));
    expect(c.total.toFixed(2)).toBe('5.00'); // 30 × 0.1 + 10 × 0.2 = 3 + 2
  });
});

describe('validateUsageLimit', () => {
  it('accepts a sensible rule in each mode', () => {
    expect(validateUsageLimit(pct(25))).toBeNull();
    expect(validateUsageLimit(perUnit(12.5))).toBeNull();
    expect(validateUsageLimit(oneTime(500))).toBeNull();
    expect(validateUsageLimit({ limitUnits: 0.5, mode: 'PERCENT', value: 0 })).toBeNull();
  });

  it('refuses a missing, zero, negative or huge limit', () => {
    expect(validateUsageLimit(null)).toMatch(/missing/);
    expect(validateUsageLimit({ mode: 'PERCENT', value: 5 })).toMatch(/limit/);
    expect(validateUsageLimit(pct(25, 0))).toMatch(/limit/);
    expect(validateUsageLimit(pct(25, -3))).toMatch(/limit/);
    expect(validateUsageLimit(pct(25, 1_000_000))).toMatch(/too large/);
    expect(validateUsageLimit({ limitUnits: '20', mode: 'PERCENT', value: 5 })).toMatch(/limit/);
  });

  it('refuses an unknown mode and a bad extra', () => {
    expect(validateUsageLimit({ limitUnits: 20, mode: 'DOUBLE', value: 5 })).toMatch(/how the units/);
    expect(validateUsageLimit(pct(-1))).toMatch(/negative/);
    expect(validateUsageLimit(pct(1001))).toMatch(/1000%/);
    expect(validateUsageLimit(perUnit(2_000_000))).toMatch(/too large/);
    expect(validateUsageLimit(pct(12.345))).toMatch(/two decimal/);
    expect(validateUsageLimit({ limitUnits: 20, mode: 'PERCENT', value: NaN })).toMatch(/negative/);
  });
});

describe('readUsageLimit', () => {
  it('reads a saved rule from a config', () => {
    expect(readUsageLimit({ usageLimit: pct(25) })).toEqual(pct(25));
  });

  it('is null when there is no rule, or the stored one is not usable', () => {
    expect(readUsageLimit({})).toBeNull();
    expect(readUsageLimit(null)).toBeNull();
    expect(readUsageLimit({ usageLimit: { limitUnits: -1, mode: 'PERCENT', value: 5 } })).toBeNull();
  });
});

describe('describeUsageLimit', () => {
  it('says it in plain words', () => {
    expect(describeUsageLimit(pct(25))).toBe('The first 20 KL a flat uses are charged at the normal rate. Each KL above that costs 25% more.');
    expect(describeUsageLimit(perUnit(10))).toContain('costs ₹10 more');
    expect(describeUsageLimit(oneTime(500))).toContain('one-time fee of ₹500');
  });
});

describe('the decimal type', () => {
  it('is the one Prisma uses', () => {
    expect(waterCharge(1, 1, null).total).toBeInstanceOf(Prisma.Decimal);
  });
});
