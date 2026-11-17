import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay, as a society's own account: its key id and secret, nothing of NG Home's. Only what online payments need:
 * check the keys, make a hosted Payment Link for one bill, and read a link back to learn whether it was paid. The link
 * is Razorpay's own page (UPI apps, cards, netbanking), so card and UPI details never pass through this server.
 */
export interface RazorpayCreds {
  keyId: string;
  keySecret: string;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Razorpay could not be reached at all (as opposed to answering with a refusal). */
    readonly unreachable = false,
  ) {
    super(message);
    this.name = 'RazorpayError';
  }
}

/** Overridable for tests; production is always Razorpay's own host. */
const base = () => (process.env.RAZORPAY_API_BASE ?? 'https://api.razorpay.com').replace(/\/+$/, '');

export const KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;
export const modeOf = (keyId: string): 'TEST' | 'LIVE' => (keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST');

/** Rupees as whole paise, exactly: ₹1,234.56 is 123456. Anything that is not a positive amount to the paisa is refused. */
export function toPaise(rupees: number | string | { toString(): string }): number {
  const text = String(rupees).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new RangeError('The amount must be a positive number of rupees and paise.');
  const [whole, frac = ''] = text.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new RangeError('The amount must be more than zero.');
  return paise;
}

export const fromPaise = (paise: number): string => (paise / 100).toFixed(2);

async function call<T>(creds: RazorpayCreds, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new RazorpayError(`Could not reach Razorpay: ${err instanceof Error ? err.message : err}`, undefined, true);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const described = json?.error?.description as string | undefined;
    if (res.status === 401) throw new RazorpayError('Razorpay did not accept these keys. Check the Key ID and Key Secret (and that they are from the same mode, test or live).', 401);
    throw new RazorpayError(described ?? `Razorpay answered with an error (${res.status}).`, res.status);
  }
  return json as T;
}

/** Whether the keys work and Payment Links are available on the account. Throws RazorpayError in Razorpay's words if not. */
export async function checkKeys(creds: RazorpayCreds): Promise<void> {
  await call(creds, 'GET', '/v1/payment_links?count=1');
}

export interface CreateLinkInput {
  amountPaise: number;
  /** Our own id for this payment, echoed back by Razorpay (at most 40 characters). */
  referenceId: string;
  description: string;
  customerName?: string;
  /** 10-digit Indian mobile; sent as +91… */
  customerPhone?: string;
  callbackUrl: string;
  /** Unix seconds; Razorpay needs it at least 15 minutes ahead. */
  expireBy: number;
}

export async function createPaymentLink(creds: RazorpayCreds, input: CreateLinkInput): Promise<{ id: string; url: string }> {
  const customer: Record<string, string> = {};
  if (input.customerName) customer.name = input.customerName.slice(0, 50);
  if (input.customerPhone) customer.contact = `+91${input.customerPhone}`;
  const link = await call<{ id: string; short_url: string }>(creds, 'POST', '/v1/payment_links', {
    amount: input.amountPaise,
    currency: 'INR',
    accept_partial: false,
    reference_id: input.referenceId,
    description: input.description.slice(0, 2000),
    ...(Object.keys(customer).length ? { customer } : {}),
    notify: { sms: false, email: false },
    reminder_enable: false,
    callback_url: input.callbackUrl,
    callback_method: 'get',
    expire_by: input.expireBy,
  });
  if (!link?.id || !link.short_url) throw new RazorpayError('Razorpay did not return a payment link.');
  return { id: link.id, url: link.short_url };
}

export interface LinkState {
  id: string;
  /** created, partially_paid, expired, cancelled or paid, as Razorpay says. */
  status: string;
  amountPaise: number;
  amountPaidPaise: number;
  referenceId: string | null;
  payments: { paymentId: string; amountPaise: number; status: string }[];
}

export async function fetchPaymentLink(creds: RazorpayCreds, linkId: string): Promise<LinkState> {
  const l = await call<any>(creds, 'GET', `/v1/payment_links/${encodeURIComponent(linkId)}`);
  return {
    id: String(l.id),
    status: String(l.status),
    amountPaise: Number(l.amount) || 0,
    amountPaidPaise: Number(l.amount_paid) || 0,
    referenceId: l.reference_id ?? null,
    payments: Array.isArray(l.payments)
      ? l.payments.map((p: any) => ({ paymentId: String(p.payment_id), amountPaise: Number(p.amount) || 0, status: String(p.status) }))
      : [],
  };
}

/** What Razorpay appends to the callback URL when the person comes back from paying. */
export interface LinkCallback {
  razorpay_payment_id?: string;
  razorpay_payment_link_id?: string;
  razorpay_payment_link_reference_id?: string;
  razorpay_payment_link_status?: string;
  razorpay_signature?: string;
}

/** True only if the callback was signed with this account's secret: id, reference, status and payment id, as Razorpay documents. */
export function callbackIsSigned(q: LinkCallback, keySecret: string): boolean {
  const { razorpay_payment_id: pay, razorpay_payment_link_id: link, razorpay_payment_link_reference_id: ref, razorpay_payment_link_status: st, razorpay_signature: sig } = q;
  if (!pay || !link || ref === undefined || !st || !sig) return false;
  const expected = createHmac('sha256', keySecret).update(`${link}|${ref}|${st}|${pay}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && timingSafeEqual(a, b);
}
