import { Prisma } from '@prisma/client';
import { discountFor, discountStatus, DiscountRule, inForce } from './flat-discounts';

const D = (n: number | string) => new Prisma.Decimal(n);
const d = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  type: 'FIXED', value: D(200), reason: 'Senior citizen', isActive: true,
  effectiveFrom: new Date('2026-04-01'), effectiveTo: null, ...over,
});
const APRIL = new Date('2026-04-01T00:00:00Z');

describe('when a discount is in force', () => {
  it('covers periods starting from its first day, with no end', () => {
    expect(inForce(d(), APRIL)).toBe(true);
    expect(inForce(d(), new Date('2030-01-01'))).toBe(true);
    expect(inForce(d(), new Date('2026-03-01'))).toBe(false);
  });

  it('stops after its last day, which is itself included', () => {
    const rule = d({ effectiveTo: new Date('2026-06-30') });
    expect(inForce(rule, new Date('2026-06-30'))).toBe(true);
    expect(inForce(rule, new Date('2026-07-01'))).toBe(false);
  });

  it('is never in force when switched off', () => {
    expect(inForce(d({ isActive: false }), APRIL)).toBe(false);
  });
});

describe('the status shown in the list', () => {
  const now = new Date('2026-05-15');
  it('reads active, scheduled, ended or off', () => {
    expect(discountStatus(d(), now)).toBe('ACTIVE');
    expect(discountStatus(d({ effectiveFrom: new Date('2026-08-01') }), now)).toBe('SCHEDULED');
    expect(discountStatus(d({ effectiveTo: new Date('2026-04-30') }), now)).toBe('ENDED');
    expect(discountStatus(d({ isActive: false }), now)).toBe('OFF');
  });
});

describe('how much is taken off', () => {
  it('takes a fixed amount as it is', () => {
    const r = discountFor([d()], D(3500), APRIL);
    expect(r.total.toString()).toBe('200');
    expect(r.reasons).toEqual(['Senior citizen']);
  });

  it('takes a percentage of the maintenance, rounded to paise', () => {
    expect(discountFor([d({ type: 'PERCENT', value: D(10) })], D(3500), APRIL).total.toString()).toBe('350');
    expect(discountFor([d({ type: 'PERCENT', value: D(7.5) })], D(1234.56), APRIL).total.toString()).toBe('92.59');
  });

  it('adds several together, but never takes more than the bill', () => {
    const r = discountFor([d({ value: D(3000) }), d({ type: 'PERCENT', value: D(50), reason: 'Other' })], D(3500), APRIL);
    expect(r.total.toString()).toBe('3500');
    expect(r.reasons).toEqual(['Senior citizen', 'Other']);
  });

  it('never goes below zero when a discount is bigger than the bill', () => {
    expect(discountFor([d({ value: D(9999) })], D(3500), APRIL).total.toString()).toBe('3500');
    expect(discountFor([d()], D(0), APRIL).total.toString()).toBe('0');
  });

  it('ignores a discount that is not in force', () => {
    const r = discountFor([d({ isActive: false }), d({ effectiveTo: new Date('2026-03-31') })], D(3500), APRIL);
    expect(r.total.toString()).toBe('0');
    expect(r.reasons).toEqual([]);
  });
});
