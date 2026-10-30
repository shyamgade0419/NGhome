/**
 * When a billing period may be deleted: only while it holds nothing. A period is a month of the
 * society's books — bills raised, payments against them, water readings, the printed statement — and
 * none of that is thrown away by deleting its header. A period made by mistake (wrong month, a
 * duplicate year) has none of it and can go.
 */

import { BillingPeriodStatus } from '@prisma/client';

export interface PeriodUsage {
  bills: number;
  payments: number;
  waterReadings: number;
  statements: number;
}

export const NO_USAGE: PeriodUsage = { bills: 0, payments: 0, waterReadings: 0, statements: 0 };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What is in the period, in words — empty when nothing is. */
export function usageParts(u: PeriodUsage): string[] {
  const parts: string[] = [];
  if (u.bills) parts.push(plural(u.bills, 'bill', 'bills'));
  if (u.payments) parts.push(plural(u.payments, 'payment', 'payments'));
  if (u.waterReadings) parts.push(plural(u.waterReadings, 'water reading', 'water readings'));
  if (u.statements) parts.push('a monthly statement');
  return parts;
}

export const hasData = (u: PeriodUsage) => usageParts(u).length > 0;

/** Published and closed periods are on the record, whatever they hold. */
const DELETABLE_STATUSES: BillingPeriodStatus[] = [BillingPeriodStatus.DRAFT, BillingPeriodStatus.CALCULATED];

/** Why this period cannot be deleted, or null when it can. */
export function deleteBlocker(status: BillingPeriodStatus, usage: PeriodUsage): string | null {
  if (!DELETABLE_STATUSES.includes(status)) {
    return 'A published or closed period is part of the record and cannot be deleted.';
  }
  const parts = usageParts(usage);
  if (parts.length > 0) {
    return `This period already has data (${parts.join(', ')}), so it cannot be deleted.`;
  }
  return null;
}
