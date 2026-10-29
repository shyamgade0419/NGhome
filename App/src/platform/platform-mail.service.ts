import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, MailSetup } from '../mail/mail.service';

export interface MailCheckResult {
  setup: MailSetup;
  /** Whether the server could log in to the mail server. */
  connection: { ok: true } | { ok: false; reason: string };
  /** A real message sent to the admin running the check; null when the login already failed. */
  test: { to: string; ok: true } | { to: string; ok: false; reason: string } | null;
}

/**
 * The platform console's "is email working?" check. Password reset and invite
 * emails are sent in the background and a failure only reaches the server log,
 * which is easy to miss. This runs the whole path on demand — log in, then
 * send a real message to the admin who asked — and says exactly where it stops.
 */
/**
 * Each step gets this long. The browser gives up on the whole request after 30s,
 * and a firewalled mail port can keep a step hanging past that — the admin then
 * sees a generic "could not run" instead of the answer. Two steps at 12s stay
 * inside the 30s, so a silent server is reported as exactly that.
 */
export const MAIL_STEP_DEADLINE_MS = 12_000;

function within<T extends { ok: boolean }>(promise: Promise<T>, what: string): Promise<T | { ok: false; reason: string }> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<{ ok: false; reason: string }>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          reason:
            `${what} got no answer from the mail server in ${MAIL_STEP_DEADLINE_MS / 1000} seconds. ` +
            'The server address or port is wrong, or a firewall is dropping the connection ' +
            '(many hosts block outgoing mail on ports 25 and 465 — try 587).',
        }),
      MAIL_STEP_DEADLINE_MS,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

@Injectable()
export class PlatformMailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async check(actorId: string): Promise<MailCheckResult> {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { email: true } });
    if (!actor) throw new NotFoundException('Admin not found');

    const setup = this.mail.describe();
    const connection = await within(this.mail.verifyConnection(), 'Logging in');
    if (!connection.ok) return { setup, connection, test: null };

    const sent = await within(this.mail.sendTest(actor.email), 'Sending the test message');
    return { setup, connection, test: sent.ok ? { to: actor.email, ok: true } : { to: actor.email, ok: false, reason: sent.reason } };
  }
}
