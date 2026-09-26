/**
 * Creates (or, with PLATFORM_ADMIN_RESET=true, resets) the NovaGade platform
 * admin — the account that signs in at /platform (/Admin) to manage societies.
 * Unlike seed.ts this touches nothing else: no demo society, no demo users.
 *
 * The credentials come from the environment, never argv, so the password
 * doesn't land in shell history or process listings, and it is never printed.
 *
 *   PLATFORM_ADMIN_EMAIL=you@novagade.in PLATFORM_ADMIN_PASSWORD='…' \
 *     npm run platform-admin:create        # dev (ts-node)
 *     npm run platform-admin:create:prod   # against the built dist/
 *
 * An email that already exists is left alone unless PLATFORM_ADMIN_RESET=true,
 * so a typo can't silently promote a resident or overwrite a password.
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const MIN_PASSWORD_LENGTH = 12;

// Values that ship in this repo (seed.ts, .env.example) and so are public.
const KNOWN_PUBLIC_PASSWORDS = new Set(['Admin@Demo123!', 'ChangeMe123!']);

export function validateCredentials(email: string | undefined, password: string | undefined): string[] {
  const problems: string[] = [];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    problems.push('PLATFORM_ADMIN_EMAIL must be a valid email address.');
  }
  if (!password) {
    problems.push('PLATFORM_ADMIN_PASSWORD is not set.');
  } else {
    if (password.length < MIN_PASSWORD_LENGTH) {
      problems.push(`PLATFORM_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (KNOWN_PUBLIC_PASSWORDS.has(password)) {
      problems.push('PLATFORM_ADMIN_PASSWORD is a value published in this repository — choose another.');
    }
  }
  return problems;
}

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const reset = process.env.PLATFORM_ADMIN_RESET === 'true';

  const problems = validateCredentials(email, password);
  if (problems.length > 0) {
    problems.forEach((p) => console.error(`✗ ${p}`));
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: email! } });
    const passwordHash = await argon2.hash(password!);

    if (!existing) {
      await prisma.user.create({
        data: {
          email: email!,
          passwordHash,
          firstName: process.env.PLATFORM_ADMIN_FIRST_NAME?.trim() || 'Platform',
          lastName: process.env.PLATFORM_ADMIN_LAST_NAME?.trim() || 'Admin',
          isPlatformAdmin: true,
          isActive: true,
          emailVerified: true,
        },
      });
      console.log(`✓ Created platform admin ${email}. Sign in at /Admin.`);
      return;
    }

    if (!reset) {
      console.error(
        `✗ ${email} already exists (platform admin: ${existing.isPlatformAdmin}). ` +
          'Re-run with PLATFORM_ADMIN_RESET=true to set this password and grant platform-admin access.',
      );
      process.exit(1);
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, isPlatformAdmin: true, isActive: true, emailVerified: true },
    });
    console.log(`✓ Reset ${email}: new password set, platform-admin access on.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('✗ Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
