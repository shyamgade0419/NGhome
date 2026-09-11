import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('mail.host');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('mail.port'),
        secure: this.config.get<number>('mail.port') === 465,
        auth: {
          user: this.config.get<string>('mail.user'),
          pass: this.config.get<string>('mail.pass'),
        },
        // nodemailer waits two minutes by default. A firewalled mail port
        // drops packets rather than refusing them, so without these a broken
        // setup looks like a hang rather than an error.
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
    }
  }

  /**
   * Reports on every boot whether email works, in the container log.
   *
   * The production image carries only the compiled app — no scripts, no
   * ts-node — so there is no terminal step for checking SMTP. And because
   * password reset deliberately always reports success to the user, a broken
   * mail setup is otherwise invisible until someone notices they never got
   * the email. One line per deploy removes the guesswork.
   *
   * Not awaited: a slow or unreachable mail server must never delay startup,
   * or the container healthcheck would fail and the deploy would roll back
   * over a problem that only affects email.
   */
  onModuleInit() {
    if (!this.transporter) {
      this.logger.warn(
        'SMTP_HOST is not set — password reset emails are NOT being sent. ' +
          'The reset link is written to this log instead.',
      );
      return;
    }
    // verifyConnection already turns errors into a result, but this chain is
    // deliberately unawaited and Node 22 kills the process on an unhandled
    // rejection — so the catch stays, in case anything here ever does throw.
    void this.verifyConnection()
      .then((result) => {
        if (result.ok) {
          this.logger.log(
            `SMTP ready — ${this.config.get('mail.user')} via ` +
              `${this.config.get('mail.host')}:${this.config.get('mail.port')}`,
          );
        } else {
          this.logger.error(
            `SMTP check failed — password reset emails will not arrive: ${result.reason}`,
          );
        }
      })
      .catch((err) =>
        this.logger.error(`SMTP check could not run: ${err instanceof Error ? err.message : err}`),
      );
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const subject = 'Reset your NG Home password';

    // Brand navy, matching the app icon, splash and login screen. This used
    // the pre-rebrand blue (#1B4FFF), so the first thing a locked-out user saw
    // from NG Home looked like it came from somewhere else.
    const navy = '#0D2147';

    // Inline styles and a table-free layout, since email clients strip <style>
    // blocks. The raw link is repeated beneath the button: some clients block
    // styled links or images, and a user who cannot click the button is
    // otherwise stuck on the one screen whose whole job is getting them back in.
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#2B2620">
        <h2 style="color:${navy};margin:0 0 12px">Reset your password</h2>
        <p style="margin:0 0 12px">We received a request to reset the password for your NG Home account.</p>
        <p style="margin:0 0 4px">Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:${navy};color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="color:#6B6153;font-size:13px;margin:0 0 4px">Button not working? Copy this link into your browser:</p>
        <p style="font-size:12px;word-break:break-all;margin:0 0 16px"><a href="${resetUrl}" style="color:${navy}">${resetUrl}</a></p>
        <p style="color:#6B6153;font-size:13px;margin:0">
          If you didn't request this, you can safely ignore this email — your password won't change.
        </p>
        <hr style="border:none;border-top:1px solid #DFD4BF;margin:24px 0">
        <p style="color:#857A67;font-size:12px;margin:0">NG Home by NovaGade</p>
      </div>
    `;

    // A plain-text part alongside the HTML. HTML-only mail is a common spam
    // signal, and that matters more than usual for a sender domain that has
    // never sent from this app before.
    const text = [
      'Reset your NG Home password',
      '',
      'We received a request to reset the password for your NG Home account.',
      'Open this link to choose a new password. It expires in 1 hour:',
      '',
      resetUrl,
      '',
      "If you didn't request this, you can safely ignore this email — your password won't change.",
      '',
      'NG Home by NovaGade',
    ].join('\n');

    if (!this.transporter) {
      // Only in development: this branch runs whenever SMTP happens to be
      // unconfigured, which is not the same thing as being in development —
      // a production deployment that hasn't set SMTP_HOST yet (or lost its
      // SMTP config) would otherwise write a live, usable password-reset
      // token straight into the application logs. In production, log only
      // that mail delivery isn't working — never the token or link.
      if (this.config.get<string>('nodeEnv') === 'production') {
        this.logger.error(
          `SMTP is not configured — a password-reset email to ${to} could not be sent. ` +
            'Set SMTP_HOST, SMTP_USER and SMTP_PASS.',
        );
        return;
      }
      this.logger.warn(`[DEV] Password reset link for ${to}: ${resetUrl}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get<string>('mail.from'),
      to,
      subject,
      html,
      text,
    });
  }

  /**
   * Checks the SMTP login without sending anything. Used by
   * scripts/check-smtp.ts so credentials can be proven before a real user's
   * reset depends on them. Returns why it failed rather than throwing, so the
   * caller can report it plainly.
   */
  async verifyConnection(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.transporter) return { ok: false, reason: 'SMTP_HOST is not set' };
    try {
      await this.transporter.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
