/**
 * Raising or lowering a fund or a bank balance by hand: the checks the server makes (so the form says so before
 * sending) and a plain-words preview of what the change does, so the admin sees the effect on the bank and on
 * the general money before saving. Mirrors Web/lib/adjustments.ts.
 */

import { inr } from '@/utils/format';

export type AdjustDirection = 'INCREASE' | 'DECREASE';

const rupees = (n: number) => inr(n, { decimals: true });

/** What is wrong with the form, or null when it can be sent. */
export function adjustmentProblem(amount: string, comment: string, direction: AdjustDirection, balance: number): string | null {
  const text = amount.trim();
  const n = Number(text);
  if (!text || !Number.isFinite(n) || n <= 0) return 'Enter an amount greater than zero.';
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return 'An amount can have at most two decimal places.';
  if (direction === 'DECREASE' && Number.isFinite(balance) && n > balance) {
    return `That is more than the ${rupees(balance)} held, so it cannot be taken out.`;
  }
  if (comment.trim().length < 3) return 'Add a comment saying why.';
  return null;
}

/**
 * The effect of the change in words, or null until there is a valid amount.
 * `general` is the maintenance and general money now (the bank minus the funds), when known.
 */
export function adjustmentEffect(p: {
  kind: 'fund' | 'account';
  name: string;
  direction: AdjustDirection;
  amount: string;
  balance: number;
  general: number | null;
  /** For a fund: the bank account moves with it. */
  bankMoves?: boolean;
}): string | null {
  const n = Number(p.amount);
  if (!p.amount.trim() || !Number.isFinite(n) || n <= 0) return null;
  const up = p.direction === 'INCREASE';
  const signed = up ? n : -n;
  const first = `${p.name} goes from ${rupees(p.balance)} to ${rupees(p.balance + signed)}.`;

  if (p.kind === 'account') {
    const general = p.general == null ? '' : ` The funds do not change, so the maintenance and general money goes from ${rupees(p.general)} to ${rupees(p.general + signed)}.`;
    return first + general;
  }
  if (p.bankMoves) {
    return `${first} The bank account ${up ? 'goes up' : 'goes down'} by the same, so the maintenance and general money stays where it is.`;
  }
  const general = p.general == null ? '' : ` The bank stays the same, so the maintenance and general money goes from ${rupees(p.general)} to ${rupees(p.general - signed)}.`;
  return first + general;
}
