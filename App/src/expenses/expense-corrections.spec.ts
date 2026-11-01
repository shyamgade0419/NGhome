import { Prisma } from '@prisma/client';
import {
  MAX_EXPENSE_AMOUNT, amountDelta, correctionLedgerText, correctionRefusal, planExpenseChanges, type ExpenseFields,
} from './expense-corrections';

const D = (v: string | number) => new Prisma.Decimal(v);

const base: ExpenseFields = {
  amount: D('1500.00'),
  expenseDate: new Date('2026-10-03T00:00:00.000Z'),
  description: 'Generator service',
  vendorPayee: 'Kumar Motors',
  invoiceNumber: 'INV-7',
  referenceNumber: null,
  categoryId: 'cat-1',
  notes: null,
};

describe('planExpenseChanges', () => {
  it('reports nothing when nothing differs, even if every field is sent back', () => {
    expect(planExpenseChanges(base, { ...base })).toEqual({});
    expect(planExpenseChanges(base, {})).toEqual({});
  });

  it('treats 1500 and 1500.00 as the same amount', () => {
    expect(planExpenseChanges(base, { amount: D(1500) })).toEqual({});
  });

  it('reports the old and new amount and date', () => {
    const changes = planExpenseChanges(base, { amount: D('1800.50'), expenseDate: new Date('2026-10-04T00:00:00.000Z') });
    expect(changes.amount).toEqual({ from: '1500.00', to: '1800.50' });
    expect(changes.expenseDate).toEqual({ from: '2026-10-03T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' });
  });

  it('ignores whitespace and empty-versus-missing text', () => {
    expect(planExpenseChanges(base, { description: '  Generator service ', notes: '   ', referenceNumber: '' })).toEqual({});
  });

  it('reports clearing a field', () => {
    expect(planExpenseChanges(base, { vendorPayee: '' }).vendorPayee).toEqual({ from: 'Kumar Motors', to: null });
  });

  it('reports a category change, including removing the category', () => {
    expect(planExpenseChanges(base, { categoryId: 'cat-2' }).categoryId).toEqual({ from: 'cat-1', to: 'cat-2' });
    expect(planExpenseChanges(base, { categoryId: null }).categoryId).toEqual({ from: 'cat-1', to: null });
  });
});

describe('correctionRefusal', () => {
  const ok = { isAdmin: true, reason: 'Typed the wrong amount', amountChanges: true, eventLinked: false };

  it('lets anyone fix a pending expense without a comment', () => {
    expect(correctionRefusal({ ...ok, status: 'PENDING', isAdmin: false, reason: undefined })).toBeNull();
  });

  it('never lets a rejected expense be edited', () => {
    expect(correctionRefusal({ ...ok, status: 'REJECTED' })?.kind).toBe('forbidden');
  });

  it('keeps approved and paid expenses to the admin', () => {
    for (const status of ['APPROVED', 'PAID']) {
      const refusal = correctionRefusal({ ...ok, status, isAdmin: false });
      expect(refusal?.kind).toBe('forbidden');
      expect(refusal?.message).toMatch(/Only the society admin/);
    }
  });

  it('wants a real comment for an approved or paid expense', () => {
    for (const reason of [undefined, '', '   ', 'ab']) {
      const refusal = correctionRefusal({ ...ok, status: 'PAID', reason });
      expect(refusal?.kind).toBe('invalid');
      expect(refusal?.message).toMatch(/comment/);
    }
    expect(correctionRefusal({ ...ok, status: 'PAID' })).toBeNull();
  });

  it('will not change the amount of an expense that came from an event, but allows the rest', () => {
    expect(correctionRefusal({ ...ok, status: 'APPROVED', eventLinked: true })?.message).toMatch(/undo the recording/);
    expect(correctionRefusal({ ...ok, status: 'APPROVED', eventLinked: true, amountChanges: false })).toBeNull();
  });
});

describe('amountDelta and the ledger text', () => {
  it('is positive when more was spent and negative when some comes back', () => {
    expect(amountDelta(D('1500'), D('1800.25')).toFixed(2)).toBe('300.25');
    expect(amountDelta(D('1500'), D('1200')).toFixed(2)).toBe('-300.00');
    expect(amountDelta(D('1500'), D('1500.00')).isZero()).toBe(true);
  });

  it('writes the old amount, the new amount and the comment on the ledger', () => {
    expect(correctionLedgerText('Generator service', '1500.00', '1800.00', ' Wrong invoice read ')).toBe(
      'Correction: Generator service (₹1500.00 → ₹1800.00) — Wrong invoice read',
    );
  });

  it('keeps the ledger text inside the column', () => {
    expect(correctionLedgerText('x'.repeat(600), '1', '2', 'why').length).toBe(500);
  });

  it('has a ceiling that fits the money column', () => {
    expect(MAX_EXPENSE_AMOUNT.toFixed(2)).toBe('999999999.99');
  });
});
