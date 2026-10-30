import { Prisma } from '@prisma/client';
import { isOverdue, lastFreeDay, lateFeeAmount, lateFeeEnabled, overdueDueDateCutoff } from './late-fee';

const D = (n: number | string) => new Prisma.Decimal(n);
const settings = (over: Partial<Parameters<typeof lateFeeAmount>[0]> = {}) => ({
  lateFeeType: 'FIXED', lateFeeValue: D(100), lateFeeMaxAmount: null, gracePeriodDays: 5, ...over,
});

describe('late fee amount', () => {
  it('is the fixed amount, whatever is unpaid', () => {
    expect(lateFeeAmount(settings(), D(5000)).toString()).toBe('100');
    expect(lateFeeAmount(settings(), D(1)).toString()).toBe('100');
  });

  it('is a percentage of what is still unpaid on the bill', () => {
    expect(lateFeeAmount(settings({ lateFeeType: 'PERCENTAGE', lateFeeValue: D(5) }), D(2000)).toString()).toBe('100');
    expect(lateFeeAmount(settings({ lateFeeType: 'PERCENTAGE', lateFeeValue: D(2.5) }), D(1000)).toString()).toBe('25');
  });

  it('rounds to paise', () => {
    expect(lateFeeAmount(settings({ lateFeeType: 'PERCENTAGE', lateFeeValue: D(3) }), D('333.33')).toString()).toBe('10');
    expect(lateFeeAmount(settings({ lateFeeType: 'PERCENTAGE', lateFeeValue: D(1) }), D('123.45')).toString()).toBe('1.23');
  });

  it('never goes above the cap', () => {
    expect(lateFeeAmount(settings({ lateFeeType: 'PERCENTAGE', lateFeeValue: D(10), lateFeeMaxAmount: D(150) }), D(5000)).toString()).toBe('150');
    expect(lateFeeAmount(settings({ lateFeeMaxAmount: D(50) }), D(5000)).toString()).toBe('50');
  });

  it('ignores a cap of zero (no cap)', () => {
    expect(lateFeeAmount(settings({ lateFeeMaxAmount: D(0) }), D(5000)).toString()).toBe('100');
  });

  it('is nothing when switched off, set to zero, or nothing is unpaid', () => {
    expect(lateFeeAmount(settings({ lateFeeType: 'NONE' }), D(5000)).toString()).toBe('0');
    expect(lateFeeAmount(settings({ lateFeeType: null }), D(5000)).toString()).toBe('0');
    expect(lateFeeAmount(settings({ lateFeeValue: D(0) }), D(5000)).toString()).toBe('0');
    expect(lateFeeAmount(settings(), D(0)).toString()).toBe('0');
  });

  it('knows whether a fine is switched on', () => {
    expect(lateFeeEnabled(settings())).toBe(true);
    expect(lateFeeEnabled(settings({ lateFeeType: 'percentage' }))).toBe(true);
    expect(lateFeeEnabled(settings({ lateFeeType: 'NONE' }))).toBe(false);
    expect(lateFeeEnabled(settings({ lateFeeValue: null }))).toBe(false);
  });
});

describe('when a bill is overdue', () => {
  const due = new Date('2026-10-10T00:00:00.000Z');

  it('has its last free day at the due date plus the grace days', () => {
    expect(lastFreeDay(due, 0)).toBe('2026-10-10');
    expect(lastFreeDay(due, 5)).toBe('2026-10-15');
    expect(lastFreeDay(new Date('2026-10-30T00:00:00.000Z'), 5)).toBe('2026-11-04');
  });

  it('is not overdue on the last free day, and is from the day after', () => {
    // 2026-10-15 noon India time is still the last free day with 5 days of grace.
    expect(isOverdue(due, 5, new Date('2026-10-15T06:30:00.000Z'))).toBe(false);
    expect(isOverdue(due, 5, new Date('2026-10-16T06:30:00.000Z'))).toBe(true);
  });

  it('counts the day in India time, not UTC', () => {
    // 2026-10-15 20:00 UTC is already 16 October in India.
    expect(isOverdue(due, 5, new Date('2026-10-15T20:00:00.000Z'))).toBe(true);
    expect(isOverdue(due, 5, new Date('2026-10-15T17:00:00.000Z'))).toBe(false);
  });

  it('has no grace when set to zero, or negative', () => {
    expect(isOverdue(due, 0, new Date('2026-10-11T06:30:00.000Z'))).toBe(true);
    expect(isOverdue(due, -3, new Date('2026-10-10T06:30:00.000Z'))).toBe(false);
  });

  it('gives a query cut-off that agrees with isOverdue', () => {
    const now = new Date('2026-10-16T06:30:00.000Z');
    const cutoff = overdueDueDateCutoff(5, now);
    expect(cutoff.toISOString().slice(0, 10)).toBe('2026-10-10');
    // A bill due on the cut-off is overdue; one due the next day is not yet.
    expect(isOverdue(cutoff, 5, now)).toBe(true);
    expect(isOverdue(new Date(cutoff.getTime() + 86_400_000), 5, now)).toBe(false);
  });
});
