/** Online payments through the society's own Razorpay account (resident side). */

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

/** True while the payment can still turn into a paid one. */
export const isOpen = (o: OnlineOutcome): boolean => o === 'WAITING';

/** What to tell the person when a payment ends; null while it is still open. */
export function outcomeMessage(o: OnlineOutcome): { title: string; body: string; ok: boolean } | null {
  switch (o) {
    case 'PAID':
      return { title: 'Payment received', body: 'Your payment is recorded and your bill is updated.', ok: true };
    case 'NEEDS_REVIEW':
      return { title: 'Payment received', body: 'Your society will confirm it against your bill shortly.', ok: true };
    case 'EXPIRED':
      return { title: 'Payment page expired', body: 'No money was taken. You can start again.', ok: false };
    case 'FAILED':
      return { title: 'Payment did not go through', body: 'If money was taken from your account it comes back to you, usually within a few days.', ok: false };
    default:
      return null;
  }
}

/** The amount as rupees and paise the server accepts ("1500", "1500.5", "1500.50"), or null when it is not a positive amount. */
export function cleanAmount(text: string): string | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t) > 0 ? t : null;
}
