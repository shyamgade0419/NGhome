import * as crypto from 'crypto';

/**
 * Unambiguous character set for human-readable join codes.
 * Excludes 0/O and 1/I to prevent transcription errors.
 */
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a single join code in the format XXXX-XXXX (9 printable chars).
 * Uses crypto.randomInt for cryptographically secure randomness.
 */
export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 9; i++) {
    if (i === 4) { code += '-'; continue; }
    code += CHARS[crypto.randomInt(CHARS.length)];
  }
  return code;
}

/**
 * Generate a join code that is guaranteed unique in the societies table.
 * Accepts a Prisma client or transaction client so it works inside transactions.
 *
 * @param prismaClient  The Prisma client or transaction client to check uniqueness.
 * @param maxAttempts   Max retries before appending raw entropy (default 10).
 */
export async function generateUniqueJoinCode(
  prismaClient: { society: { findUnique: (args: { where: { joinCode: string } }) => Promise<unknown | null> } },
  maxAttempts = 10,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateJoinCode();
    const existing = await prismaClient.society.findUnique({ where: { joinCode: code } });
    if (!existing) return code;
  }
  // Statistically unreachable, but safe fallback
  return generateJoinCode() + crypto.randomBytes(2).toString('hex').toUpperCase();
}
