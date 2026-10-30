import { BillingPeriodStatus } from '@prisma/client';
import { NO_USAGE, deleteBlocker, hasData, usageParts } from './billing-period-delete';

describe('billing period delete rule', () => {
  it('allows an empty draft or calculated period', () => {
    expect(deleteBlocker(BillingPeriodStatus.DRAFT, NO_USAGE)).toBeNull();
    expect(deleteBlocker(BillingPeriodStatus.CALCULATED, NO_USAGE)).toBeNull();
  });

  it('blocks on any one kind of data, naming it', () => {
    expect(deleteBlocker(BillingPeriodStatus.DRAFT, { ...NO_USAGE, bills: 1 })).toContain('1 bill)');
    expect(deleteBlocker(BillingPeriodStatus.DRAFT, { ...NO_USAGE, payments: 2 })).toContain('2 payments');
    expect(deleteBlocker(BillingPeriodStatus.DRAFT, { ...NO_USAGE, waterReadings: 1 })).toContain('1 water reading');
    expect(deleteBlocker(BillingPeriodStatus.DRAFT, { ...NO_USAGE, statements: 1 })).toContain('statement');
  });

  it('lists everything that is there, in one sentence', () => {
    expect(usageParts({ bills: 12, payments: 3, waterReadings: 1, statements: 1 })).toEqual([
      '12 bills', '3 payments', '1 water reading', 'a monthly statement',
    ]);
  });

  it('blocks a published or closed period even when it holds nothing', () => {
    for (const s of [BillingPeriodStatus.PUBLISHED, BillingPeriodStatus.PARTIALLY_PAID, BillingPeriodStatus.PAID, BillingPeriodStatus.CLOSED, BillingPeriodStatus.REVIEW]) {
      expect(deleteBlocker(s, NO_USAGE)).toMatch(/published or closed/);
    }
  });

  it('knows an empty period from a full one', () => {
    expect(hasData(NO_USAGE)).toBe(false);
    expect(hasData({ ...NO_USAGE, bills: 1 })).toBe(true);
  });
});
