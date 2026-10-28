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
    const connection = await this.mail.verifyConnection();
    if (!connection.ok) return { setup, connection, test: null };

    const sent = await this.mail.sendTest(actor.email);
    return { setup, connection, test: sent.ok ? { to: actor.email, ok: true } : { to: actor.email, ok: false, reason: sent.reason } };
  }
}
