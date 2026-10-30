import { ExpenseStatus } from '@prisma/client';
import { MAX_RECEIPTS_PER_EXPENSE, canAddReceipt, canRemoveReceipt, isReceiptType } from './expense-receipts';

describe('expense receipts — rules', () => {
  it('accepts what a camera or a scanner makes, and nothing else', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']) {
      expect(isReceiptType(t)).toBe(true);
    }
    for (const t of ['text/html', 'image/svg+xml', 'application/msword', 'text/csv', '']) {
      expect(isReceiptType(t)).toBe(false);
    }
  });

  it('takes new receipts on every expense except a rejected one', () => {
    expect(canAddReceipt(ExpenseStatus.PENDING)).toBe(true);
    expect(canAddReceipt(ExpenseStatus.APPROVED)).toBe(true);
    expect(canAddReceipt(ExpenseStatus.PAID)).toBe(true);
    expect(canAddReceipt(ExpenseStatus.REJECTED)).toBe(false);
  });

  it('lets receipts be removed until the expense is paid', () => {
    expect(canRemoveReceipt(ExpenseStatus.PENDING)).toBe(true);
    expect(canRemoveReceipt(ExpenseStatus.APPROVED)).toBe(true);
    expect(canRemoveReceipt(ExpenseStatus.REJECTED)).toBe(true);
    expect(canRemoveReceipt(ExpenseStatus.PAID)).toBe(false);
  });

  it('caps receipts at a handful', () => {
    expect(MAX_RECEIPTS_PER_EXPENSE).toBeGreaterThanOrEqual(3);
    expect(MAX_RECEIPTS_PER_EXPENSE).toBeLessThanOrEqual(10);
  });
});
