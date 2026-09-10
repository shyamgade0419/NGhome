/**
 * Proves the SMTP settings work before a real password reset depends on them.
 *
 *   npx ts-node scripts/check-smtp.ts                  # login check only
 *   npx ts-node scripts/check-smtp.ts you@example.com  # also sends a test reset email
 *
 * Reads the same SMTP_* and APP_URL variables the app does, from App/.env,
 * and runs them through the real MailService — so a pass here means the
 * actual template, sender and link format all work, not just the login.
 *
 * Never prints the password.
 */

import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import configuration from '../src/config/configuration';
import { MailService } from '../src/mail/mail.service';

async function main() {
  const config = new ConfigService(configuration());
  const mail = config.get('mail') as Record<string, unknown>;

  console.log('SMTP settings in use:');
  console.log(`  host   ${mail.host ?? '(not set)'}`);
  console.log(`  port   ${mail.port}${mail.port === 465 ? '  (implicit TLS)' : ''}`);
  console.log(`  user   ${mail.user ?? '(not set)'}`);
  console.log(`  pass   ${mail.pass ? '(set)' : '(NOT SET)'}`);
  console.log(`  from   ${mail.from}`);
  console.log(`  appUrl ${mail.appUrl}`);

  // The fallback sender is on a different domain from the login. Servers
  // either refuse it or it fails SPF/DMARC at the recipient, so flag it now
  // rather than discover it as "emails are going to spam".
  const userDomain = String(mail.user ?? '').split('@')[1];
  const fromDomain = String(mail.from ?? '').match(/@([^>\s]+)/)?.[1];
  if (userDomain && fromDomain && userDomain.toLowerCase() !== fromDomain.toLowerCase()) {
    console.log(
      `\n  ⚠ SMTP_FROM is on ${fromDomain} but you log in as ${userDomain}. ` +
        'Expect rejection or spam — set SMTP_FROM to an address on the same domain.',
    );
  }

  const service = new MailService(config);
  const result = await service.verifyConnection();
  if (!result.ok) {
    console.log(`\n✖ Login failed: ${result.reason}`);
    process.exit(1);
  }
  console.log('\n✔ Logged in to the SMTP server.');

  const to = process.argv[2];
  if (!to) {
    console.log('  (Pass an email address to also send a test reset email.)');
    return;
  }

  const sampleUrl = `${mail.appUrl}/reset-password?token=TEST-TOKEN-NOT-VALID`;
  await service.sendPasswordResetEmail(to, sampleUrl);
  console.log(`✔ Test reset email sent to ${to}.`);
  console.log('  Check the inbox — and the spam folder — then confirm the button and the');
  console.log('  link both point at the reset page. The token is fake, so the page will');
  console.log('  say the link is invalid; that is expected.');
}

main().catch((err) => {
  console.error('\n✖', err instanceof Error ? err.message : err);
  process.exit(1);
});
