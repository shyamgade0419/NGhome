/**
 * Correcting an expense that has already been posted: what counts as a change, and what it does to the
 * money. Pure functions with no database, so the rules are tested on their own.
 *
 * An expense is PENDING (anyone may still fix it), APPROVED (committed, but no money has moved) or PAID
 * (an account — and possibly a fund — has been debited). Once approved it is part of the books, so changing
 * it needs the admin and a comment; once paid, changing the amount also moves the account and fund by the
 * difference, so the bank balance, the funds and the expense always agree.
 */

import { Prisma } from '@prisma/client';

export const MAX_EXPENSE_AMOUNT = new Prisma.Decimal('999999999.99');
export const MIN_REASON_LENGTH = 3;

/** The fields a correction may touch. The account a paid expense came out of is deliberately not one. */
export const CORRECTABLE_FIELDS = [
  'amount', 'expenseDate', 'description', 'vendorPayee', 'invoiceNumber', 'referenceNumber', 'categoryId', 'notes',
] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export interface ExpenseFields {
  amount: Prisma.Decimal;
  expenseDate: Date;
  description: string;
  vendorPayee: string | null;
  invoiceNumber: string | null;
  referenceNumber: string | null;
  categoryId: string | null;
  notes: string | null;
}

export interface FieldChange {
  from: string | null;
  to: string | null;
}
export type ExpenseChanges = Partial<Record<CorrectableField, FieldChange>>;

const text = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * What would actually change. A field left out, or sent as it already is, is not a change — so a form that
 * posts every field back never reports (or writes) something the admin did not touch.
 */
export function planExpenseChanges(current: ExpenseFields, wanted: Partial<ExpenseFields>): ExpenseChanges {
  const out: ExpenseChanges = {};

  if (wanted.amount !== undefined && !wanted.amount.equals(current.amount)) {
    out.amount = { from: current.amount.toFixed(2), to: wanted.amount.toFixed(2) };
  }
  if (wanted.expenseDate !== undefined && wanted.expenseDate.getTime() !== current.expenseDate.getTime()) {
    out.expenseDate = { from: current.expenseDate.toISOString(), to: wanted.expenseDate.toISOString() };
  }
  for (const key of ['description', 'vendorPayee', 'invoiceNumber', 'referenceNumber', 'notes'] as const) {
    if (wanted[key] === undefined) continue;
    const from = text(current[key]);
    const to = text(wanted[key]);
    if (from !== to) out[key] = { from, to };
  }
  if (wanted.categoryId !== undefined && (wanted.categoryId ?? null) !== (current.categoryId ?? null)) {
    out.categoryId = { from: current.categoryId, to: wanted.categoryId ?? null };
  }
  return out;
}

export interface Refusal {
  /** 'forbidden' is about who or what state; 'invalid' is about what was asked for. */
  kind: 'forbidden' | 'invalid';
  message: string;
}

/** Says why an expense may not be corrected as asked, or null if it may. */
export function correctionRefusal(input: {
  status: string;
  isAdmin: boolean;
  reason: string | undefined;
  amountChanges: boolean;
  eventLinked: boolean;
}): Refusal | null {
  if (input.status === 'REJECTED') return { kind: 'forbidden', message: 'A rejected expense cannot be edited.' };
  if (input.status === 'PENDING') return null;
  if (!input.isAdmin) {
    return { kind: 'forbidden', message: 'Only the society admin can correct an approved or paid expense.' };
  }
  if ((input.reason ?? '').trim().length < MIN_REASON_LENGTH) {
    return { kind: 'invalid', message: 'Add a comment saying why you are correcting this expense.' };
  }
  if (input.eventLinked && input.amountChanges) {
    return {
      kind: 'invalid',
      message:
        "This expense was recorded from an event, and the event's fund was debited for its cost. To change the amount, " +
        'undo the recording on the event and record it again.',
    };
  }
  return null;
}

/**
 * How far the account (and fund) must move for a paid expense whose amount changes. Positive means the
 * society spent more than was booked, so more leaves the account; negative means some comes back.
 */
export function amountDelta(oldAmount: Prisma.Decimal, newAmount: Prisma.Decimal): Prisma.Decimal {
  return newAmount.minus(oldAmount);
}

/** The sentence written on the account's ledger for the correcting entry. */
export function correctionLedgerText(description: string, from: string, to: string, reason: string): string {
  return `Correction: ${description} (₹${from} → ₹${to}) — ${reason.trim()}`.slice(0, 500);
}
