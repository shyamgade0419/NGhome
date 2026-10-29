import { createHash } from 'crypto';

/**
 * A phone number reduced to the digits that identify the person: no spaces or dashes, no "+",
 * no India country code (91) or trunk zero. The same person typed as "+91 98765 43210",
 * "09876543210" and "9876543210" is one helper. Null when it cannot be a phone number.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

/**
 * A helper's pass code is hashed under its own prefix, so a visitor invitation code can never be
 * a valid helper code (or the other way round) even if the two were ever equal.
 */
export const helperCodeHash = (code: string): string => createHash('sha256').update(`helper:${code}`).digest('hex');

export const HELPER_LIMITS = {
  /** How far back a household can look at a helper's visits. */
  visitDays: 60,
} as const;
