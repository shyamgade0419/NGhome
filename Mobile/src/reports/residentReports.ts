/**
 * The working-out behind the resident Reports screen, kept apart from the screen so it can be tested on its own:
 * a resident's own statement from their bills, the month stepper, and the text they can share.
 */
import type { MaintenanceBill } from '@/types/billing.types';
import { toNum } from '@/utils/format';

export const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface YearMonth { year: number; month: number }

export const monthTitle = ({ year, month }: YearMonth): string => `${MONTH_NAMES[month] ?? ''} ${year}`.trim();

/** The month `delta` months from `from` (negative for earlier), rolling over the year. */
export function shiftMonth(from: YearMonth, delta: number): YearMonth {
  const index = from.year * 12 + (from.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const isAfter = (a: YearMonth, b: YearMonth): boolean => a.year * 12 + a.month > b.year * 12 + b.month;

export const currentMonth = (now: Date = new Date()): YearMonth => ({ year: now.getFullYear(), month: now.getMonth() + 1 });

export type StatementState = 'PAID' | 'PART' | 'DUE';

export interface StatementRow {
  id: string;
  title: string;
  invoiceNumber: string;
  total: number;
  paid: number;
  pending: number;
  state: StatementState;
  /** Used to put the newest first. */
  sort: number;
}

/**
 * A resident's bills as statement rows, newest month first. Only bills that have been published to the flat: a bill the
 * admin is still preparing is not something the resident owes yet. An opening-balance bill is labelled as that.
 */
export function statementRows(bills: MaintenanceBill[]): StatementRow[] {
  return bills
    .filter((b) => b.isPublished)
    .map((b) => {
      const total = toNum(b.totalAmount);
      const paid = toNum(b.paidAmount);
      const pending = b.isPaid ? 0 : Math.max(toNum(b.pendingAmount), 0);
      const p = b.billingPeriod;
      const title = p ? (p.kind === 'OPENING' ? 'Opening balance' : monthTitle({ year: p.periodYear, month: p.periodMonth })) : b.invoiceNumber;
      const state: StatementState = b.isPaid || pending === 0 ? 'PAID' : paid > 0 ? 'PART' : 'DUE';
      return {
        id: b.id,
        title,
        invoiceNumber: b.invoiceNumber,
        total,
        paid,
        pending,
        state,
        sort: p ? p.periodYear * 12 + p.periodMonth : new Date(b.createdAt).getTime() / 1e9,
      };
    })
    .sort((a, b) => b.sort - a.sort);
}

export function statementTotals(rows: StatementRow[]): { billed: number; paid: number; pending: number } {
  return rows.reduce(
    (t, r) => ({ billed: t.billed + r.total, paid: t.paid + r.paid, pending: t.pending + r.pending }),
    { billed: 0, paid: 0, pending: 0 },
  );
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** The statement as plain text, to share in a message or save to notes. */
export function statementText(rows: StatementRow[], flatCode?: string): string {
  const t = statementTotals(rows);
  const lines = [
    `Maintenance statement${flatCode ? ` · ${flatCode}` : ''}`,
    `Billed ${rupees(t.billed)} · Paid ${rupees(t.paid)} · Pending ${rupees(t.pending)}`,
    '',
    ...rows.map((r) => `${r.title}: ${rupees(r.total)}, paid ${rupees(r.paid)}${r.pending > 0 ? `, pending ${rupees(r.pending)}` : ''} (${r.invoiceNumber})`),
  ];
  return lines.join('\n');
}
