import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
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
      });
    }
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
