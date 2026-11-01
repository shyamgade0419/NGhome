import {
  categoryChoices, changedFields, describeChanges, editValuesOf, paidAmountEffect, validateEdit,
} from '@/utils/expenseCorrections';

const expense = {
  description: 'Generator service',
  amount: '1500',
  expenseDate: '2026-10-03T00:00:00.000Z',
  vendorPayee: 'Kumar Motors',
  invoiceNumber: 'INV-7',
  category: { name: 'REPAIRS' },
};

describe('editValuesOf', () => {
  it('starts the form from the expense, trimming the date to the day', () => {
    expect(editValuesOf(expense)).toEqual({
      description: 'Generator service', amount: '1500', expenseDate: '2026-10-03',
      category: 'REPAIRS', vendorPayee: 'Kumar Motors', invoiceNumber: 'INV-7',
    });
  });

  it('copes with missing optional fields and the older categoryName', () => {
    const v = editValuesOf({ description: 'x', amount: 10, expenseDate: '2026-01-02', categoryName: 'EVENTS' });
    expect(v.vendorPayee).toBe('');
    expect(v.invoiceNumber).toBe('');
    expect(v.category).toBe('EVENTS');
    expect(v.amount).toBe('10');
  });
});

describe('changedFields', () => {
  it('sends nothing for an untouched form', () => {
    expect(changedFields(expense, editValuesOf(expense))).toEqual({});
  });

  it('sends only what changed, with the amount as a number', () => {
    const form = { ...editValuesOf(expense), amount: '1800.50', expenseDate: '2026-10-04' };
    expect(changedFields(expense, form)).toEqual({ amount: 1800.5, expenseDate: '2026-10-04' });
  });

  it('treats 1500 and 1500.00 as the same, and ignores spaces', () => {
    const form = { ...editValuesOf(expense), amount: '1500.00', description: ' Generator service ' };
    expect(changedFields(expense, form)).toEqual({});
  });

  it('does not report a category that only differs by case, but does report a real change', () => {
    expect(changedFields(expense, { ...editValuesOf(expense), category: 'repairs' })).toEqual({});
    expect(changedFields(expense, { ...editValuesOf(expense), category: 'UTILITIES' })).toEqual({ category: 'UTILITIES' });
  });

  it('can clear the vendor', () => {
    expect(changedFields(expense, { ...editValuesOf(expense), vendorPayee: '' })).toEqual({ vendorPayee: '' });
  });
});

describe('validateEdit', () => {
  const ok = editValuesOf(expense);

  it('accepts a good form without a comment while the expense is pending', () => {
    expect(validateEdit(ok, false, '')).toBeNull();
  });

  it('wants a comment once the expense is posted', () => {
    expect(validateEdit(ok, true, '')).toMatch(/comment/);
    expect(validateEdit(ok, true, 'ab')).toMatch(/comment/);
    expect(validateEdit(ok, true, 'Typo in amount')).toBeNull();
  });

  it('refuses a missing description, a bad amount, and a bad date', () => {
    expect(validateEdit({ ...ok, description: '  ' }, false, '')).toMatch(/description/);
    expect(validateEdit({ ...ok, amount: '' }, false, '')).toMatch(/amount/);
    expect(validateEdit({ ...ok, amount: '0' }, false, '')).toMatch(/amount/);
    expect(validateEdit({ ...ok, amount: '-4' }, false, '')).toMatch(/amount/);
    expect(validateEdit({ ...ok, amount: '10.123' }, false, '')).toMatch(/two decimal/);
    expect(validateEdit({ ...ok, expenseDate: '03/10/2026' }, false, '')).toMatch(/date/);
  });
});

describe('paidAmountEffect', () => {
  it('says nothing until the expense is paid', () => {
    expect(paidAmountEffect('APPROVED', 1500, '1800', 'Main', null)).toBeNull();
    expect(paidAmountEffect('PENDING', 1500, '1800', 'Main', null)).toBeNull();
  });

  it('says nothing when the amount is unchanged or invalid', () => {
    expect(paidAmountEffect('PAID', 1500, '1500', 'Main', null)).toBeNull();
    expect(paidAmountEffect('PAID', 1500, '', 'Main', null)).toBeNull();
    expect(paidAmountEffect('PAID', 1500, '0', 'Main', null)).toBeNull();
  });

  it('says the account goes down when more was spent, and up when less was', () => {
    expect(paidAmountEffect('PAID', 1500, '1800', 'Main account', null)).toContain('Main account goes down by ₹300.00');
    expect(paidAmountEffect('PAID', 1500, '1200', 'Main account', null)).toContain('Main account goes up by ₹300.00');
  });

  it('mentions the fund when it was paid from one', () => {
    expect(paidAmountEffect('PAID', 1000, '1400', 'Main', 'Festival Fund')).toContain('Festival Fund goes down by the same');
  });
});

describe('describeChanges', () => {
  it('writes each change on a line', () => {
    const lines = describeChanges({
      amount: { from: '1500.00', to: '1800.00' },
      expenseDate: { from: '2026-10-03T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' },
      vendorPayee: { from: null, to: 'New Vendor' },
      categoryId: { from: 'a', to: 'b' },
    });
    expect(lines).toEqual([
      'Amount: ₹1,500.00 → ₹1,800.00',
      'Date: 3 Oct 2026 → 4 Oct 2026',
      'Vendor / payee: empty → New Vendor',
      'Category changed',
    ]);
  });
});

describe('categoryChoices', () => {
  it('adds the expense\'s own category when the picker does not list it', () => {
    expect(categoryChoices(['REPAIRS', 'EVENTS'], 'Gardening')).toEqual(['Gardening', 'REPAIRS', 'EVENTS']);
  });

  it('does not repeat one it already lists, whatever the case', () => {
    expect(categoryChoices(['REPAIRS', 'EVENTS'], 'Events')).toEqual(['REPAIRS', 'EVENTS']);
    expect(categoryChoices(['REPAIRS'], '')).toEqual(['REPAIRS']);
  });
});
