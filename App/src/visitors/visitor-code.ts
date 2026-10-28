import { createHash, randomInt } from 'crypto';

/**
 * Invitation codes for the gate.
 *
 * A code is 8 characters from a 31-letter alphabet with the look-alikes
 * removed (no 0/O, 1/I/L), so a resident can read it out and a guard can type
 * it without confusion. That is about 8.5 × 10^11 possibilities; with the gate
 * endpoints rate limited and every lookup scoped to one society, guessing a
 * live code is not realistic.
 *
 * Only a SHA-256 hash is stored. The code itself exists in the database
 * nowhere and is shown to the resident exactly once, at creation, so a leaked
 * backup or log cannot be used to walk through the gate. The code carries no
 * information about the resident, flat or society.
 */

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

/** A fresh, unpredictable code (cryptographically random, not Math.random). */
export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return code;
}

/** "K7QX92MD" -> "K7QX-92MD", for reading out and typing. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Whatever a person typed, reduced to a code — or null if it cannot be one.
 * Case, spaces and dashes are forgiven; characters outside the alphabet are
 * not guessed at.
 */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
