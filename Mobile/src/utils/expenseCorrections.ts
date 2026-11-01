/**
 * Correcting a posted expense, on the phone: which fields really changed (so only those are sent), what a
 * change to a paid expense does to the account, and how a correction reads in the history. The same rules
 * as the web (Web/lib/expenseCorrections.ts), kept as pure functions so they are tested without a screen.
 */

import { inr } from '@/utils/format';

export interface ExpenseEditValues {
  description: string;
  amount: string;
  expenseDate: string; // yyyy-mm-dd
  category: string;
  vendorPayee: string;
  invoiceNumber: string;
}

export interface ExpenseLike {
  description: string;
  amount: string | number;
  expenseDate: string;
  vendorPayee?: string | null;
  invoiceNumber?: string | null;
  category?: { name: string } | null;
  categoryName?: string | null;
}

/** What the form starts with: the expense as it stands. */
export function editValuesOf(e: ExpenseLike): ExpenseEditValues {
  return {
    description: e.description,
    amount: String(Number(e.amount)),
    expenseDate: e.expenseDate.slice(0, 10),
    category: e.category?.name ?? e.categoryName ?? '',
    vendorPayee: e.vendorPayee ?? '',
    invoiceNumber: e.invoiceNumber ?? '',
  };
}

const norm = (v: string | null | undefined) => (v ?? '').trim();

/** Only the fields that differ from the expense, in the shape the API takes. Nothing for an untouched form. */
export function changedFields(original: ExpenseLike, form: ExpenseEditValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const start = editValuesOf(original);
  if (Number(form.amount) !== Number(start.amount)) out.amount = Number(form.amount);
  if (form.expenseDate !== start.expenseDate) out.expenseDate = form.expenseDate;
  if (norm(form.description) !== norm(start.description)) out.description = norm(form.description);
  if (norm(form.vendorPayee) !== norm(start.vendorPayee)) out.vendorPayee = norm(form.vendorPayee);
  if (norm(form.invoiceNumber) !== norm(start.invoiceNumber)) out.invoiceNumber = norm(form.invoiceNumber);
  if (norm(form.category).toLowerCase() !== norm(start.category).toLowerCase() && norm(form.category)) out.category = norm(form.category);
  return out;
}

export function validateEdit(form: ExpenseEditValues, needsComment: boolean, comment: string): string | null {
  if (!norm(form.description)) return 'Enter a description.';
  const amount = Number(form.amount);
  if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.';
  if (!/^\d+(\.\d{1,2})?$/.test(form.amount.trim())) return 'An amount can have at most two decimal places.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expenseDate)) return 'Choose the date.';
  if (needsComment && norm(comment).length < 3) return 'Add a comment saying why you are correcting this expense.';
  return null;
}

/**
 * What changing the amount of a PAID expense does to the account it was paid from, in words, so the admin
 * sees the effect before saving. Null when the amount is unchanged or the expense has not been paid.
 */
export function paidAmountEffect(
  status: string,
  oldAmount: string | number,
  newAmount: string,
  accountName: string | null,
  fundName: string | null,
): string | null {
  if (status !== 'PAID') return null;
  const from = Number(oldAmount);
  const to = Number(newAmount);
  if (!Number.isFinite(to) || to <= 0 || to === from) return null;
  const diff = Math.abs(to - from);
  const account = accountName ?? 'The account';
  const dir = to > from ? 'goes down' : 'goes up';
  const fund = fundName ? `, and ${fundName} ${dir} by the same` : '';
  return `${account} ${dir} by ${inr(diff, { decimals: true })}${fund}. A correcting entry is added to its ledger.`;
}

export interface HistoryEntry {
  id: string;
  at: string;
  by: string | null;
  reason: string | null;
  changes: Record<string, { from: string | null; to: string | null }>;
  accountBalanceAfter: string | null;
}

const LABELS: Record<string, string> = {
  amount: 'Amount',
  expenseDate: 'Date',
  description: 'Description',
  vendorPayee: 'Vendor / payee',
  invoiceNumber: 'Invoice number',
  referenceNumber: 'Reference number',
  categoryId: 'Category',
  notes: 'Notes',
};

/** One line per changed field, e.g. "Amount: ₹1,500 → ₹1,800". */
export function describeChanges(changes: HistoryEntry['changes']): string[] {
  return Object.entries(changes).map(([field, c]) => {
    const label = LABELS[field] ?? field;
    if (field === 'categoryId') return `${label} changed`;
    const show = (v: string | null) => {
      if (v == null || v === '') return 'empty';
      if (field === 'amount') return inr(v, { decimals: true });
      if (field === 'expenseDate') return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      return v;
    };
    return `${label}: ${show(c.from)} → ${show(c.to)}`;
  });
}

/** The categories the picker offers, plus the expense's own if it is not one of them (e.g. "Events"). */
export function categoryChoices(all: string[], current: string): string[] {
  const has = current && all.some((c) => c.toLowerCase() === current.toLowerCase());
  return current && !has ? [current, ...all] : all;
}

/** The categories an expense can be filed under. The screen's Add form and the correction form share them. */
export const EXPENSE_CATEGORIES = [
  'MAINTENANCE', 'UTILITIES', 'SECURITY', 'HOUSEKEEPING', 'REPAIRS',
  'ADMINISTRATIVE', 'EVENTS', 'EQUIPMENT', 'LANDSCAPING', 'INSURANCE', 'OTHER',
];
