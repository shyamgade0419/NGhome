/**
 * The link in a "payment received" WhatsApp message that opens the receipt, with no login.
 *
 * The link carries the payment's id and a signature made with a secret only the server has, so it cannot be guessed or
 * made up for another payment: changing one character of it, or swapping in another payment's id, makes it fail. The
 * token is short enough to sit comfortably in a message: 22 characters for the id and 22 for the signature.
 *
 * The receipt shows only that payment, to whoever holds the link. It is sent to the person who made the payment.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 22 base64url characters carry 128 bits. */
const ID_PART = /^[A-Za-z0-9_-]{22}$/;
const SIG_PART = /^[A-Za-z0-9_-]{22}$/;

export const DEFAULT_PUBLIC_API_URL = 'https://nghome-api.novagade.in';

/**
 * The secret the signature is made with: its own setting, else a key the server already holds. Null when the server has
 * none at all, in which case no link is made (a message then goes without one rather than with an unsigned link).
 */
export function receiptSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.RECEIPT_LINK_SECRET || env.SETTINGS_ENCRYPTION_KEY || env.JWT_ACCESS_SECRET;
  return s && s.length >= 16 ? `receipt-link:${s}` : null;
}

const signature = (paymentId: string, secret: string): string =>
  createHmac('sha256', secret).update(`receipt:${paymentId.toLowerCase()}`).digest('base64url').slice(0, 22);

/** The payment's id as 22 characters. */
const packId = (paymentId: string): string => Buffer.from(paymentId.replace(/-/g, ''), 'hex').toString('base64url');

const unpackId = (part: string): string | null => {
  if (!ID_PART.test(part)) return null;
  const bytes = Buffer.from(part, 'base64url');
  if (bytes.length !== 16) return null;
  const h = bytes.toString('hex');
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return UUID.test(id) ? id : null;
};

/** The token for a payment, or null when the id is not a payment id. */
export function makeReceiptToken(paymentId: string, secret: string): string | null {
  if (!UUID.test(paymentId)) return null;
  return `${packId(paymentId)}.${signature(paymentId, secret)}`;
}

/** The payment id a token is for, or null when the token is malformed or its signature is wrong. */
export function readReceiptToken(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || token.length !== 45) return null;
  const [idPart, sig, extra] = token.split('.');
  if (extra !== undefined || !idPart || !sig || !SIG_PART.test(sig)) return null;
  const paymentId = unpackId(idPart);
  if (!paymentId) return null;
  // Only the exact spelling: the last character of the id part has spare bits, so more than one text decodes to the same id.
  if (packId(paymentId) !== idPart) return null;
  const want = Buffer.from(signature(paymentId, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? paymentId : null;
}

/** The full link for a payment, or null when there is no secret to sign it with. */
export function receiptUrl(paymentId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = receiptSecret(env);
  if (!secret) return null;
  const token = makeReceiptToken(paymentId, secret);
  if (!token) return null;
  const base = (env.PUBLIC_API_URL || DEFAULT_PUBLIC_API_URL).replace(/\/+$/, '');
  return `${base}/api/v1/public/receipts/${token}`;
}

/** A receipt number people can quote: 'RCT-' and the first eight characters of the payment id. */
export const receiptNumber = (paymentId: string): string => `RCT-${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
