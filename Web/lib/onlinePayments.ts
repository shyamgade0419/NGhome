/** Online payments through the society's own Razorpay account. */

export interface OnlineGateway {
  /** Keys are saved. */
  connected: boolean;
  /** Residents are offered "Pay online". */
  enabled: boolean;
  provider: 'RAZORPAY';
  keyId: string | null;
  /** TEST moves no money; LIVE is real. */
  mode: 'TEST' | 'LIVE' | null;
  settlementAccount: { id: string; name: string } | null;
  /** Why it is connected but cannot take payments; null when all is well. */
  problem: string | null;
}

/** WAITING: not paid yet (or being recorded). PAID: in the books. NEEDS_REVIEW: received, waiting for the admin to confirm it. */
export type OnlineOutcome = 'WAITING' | 'PAID' | 'NEEDS_REVIEW' | 'EXPIRED' | 'FAILED';

export interface OnlineOrder {
  id: string;
  outcome: OnlineOutcome;
  amount: string;
  paidAt: string | null;
  /** The Razorpay page to pay on. */
  url: string | null;
}

export interface OnlineRecent {
  id: string;
  flatCode: string | null;
  amount: string;
  outcome: OnlineOutcome;
  createdAt: string;
  paidAt: string | null;
  reason: string | null;
}

export const OUTCOME_LABEL: Record<OnlineOutcome, string> = {
  WAITING: 'Waiting',
  PAID: 'Paid',
  NEEDS_REVIEW: 'Needs your approval',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
};

/** True while the payment can still turn into a paid one. */
export const isOpen = (o: OnlineOutcome): boolean => o === 'WAITING';

/** A message for a payment that ended, or null while it is still open. */
export function outcomeMessage(o: OnlineOutcome): { kind: 'success' | 'info' | 'error'; text: string } | null {
  switch (o) {
    case 'PAID':
      return { kind: 'success', text: 'Payment received. Your bill is updated.' };
    case 'NEEDS_REVIEW':
      return { kind: 'info', text: 'Payment received. Your society will confirm it against your bill shortly.' };
    case 'EXPIRED':
      return { kind: 'error', text: 'That payment page expired. No money was taken. Start again.' };
    case 'FAILED':
      return { kind: 'error', text: 'The payment did not go through. If money was taken it comes back to you, usually within a few days.' };
    default:
      return null;
  }
}
