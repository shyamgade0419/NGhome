import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { addressOf } from '../config/configuration';
import { MailSettingsStore } from './mail-settings.store';

export interface MailSetup {
  /** Where these settings come from: the platform console, the server environment, or nowhere. */
  source: 'console' | 'environment' | 'none';
  configured: boolean;
  host: string | null;
  port: number | null;
  /** The login, partly hidden: ab***@example.com */
  user: string | null;
  from: string;
  appUrl: string;
  warnings: string[];
}

/** Enough of an address to recognise it, not enough to use it. */
export function maskEmail(value: string | null): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  if (at < 1) return value.length > 2 ? value.slice(0, 2) + '***' : '***';
  return value.slice(0, Math.min(2, at)) + '***' + value.slice(at);
}

interface ResolvedMail {
  source: 'console' | 'environment' | 'none';
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
  passwordUnreadable: boolean;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private cached: { key: string; transporter: nodemailer.Transporter } | null = null;

  constructor(
    private readonly config: ConfigService,
    // Optional so the mail service still works from the environment alone.
    @Optional() private readonly settings?: MailSettingsStore,
  ) {}

  /**
   * The login in force right now. Read on every send, so saving new settings in
   * the console takes effect at once with no restart: the console's settings
   * when saved, otherwise the SMTP_* environment variables.
   */
  private async resolve(): Promise<ResolvedMail> {
    let stored: Awaited<ReturnType<MailSettingsStore['load']>> = null;
    try {
      stored = (await this.settings?.load()) ?? null;
    } catch (err) {
      // e.g. the table is not there yet. Mail must keep working from the environment.
      this.logger.warn(
        `Could not read the mail settings saved in the console, using the environment: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (stored) {
      const mailbox = stored.fromAddress ?? addressOf(stored.username);
      const name = (stored.fromName ?? 'NG Home').replace(/[<>"\r\n]/g, '').trim() || 'NG Home';
      return {
        source: 'console',
        host: stored.host,
        port: stored.port,
        user: stored.username,
        pass: stored.password,
        passwordUnreadable: stored.passwordUnreadable,
        from: mailbox ? `"${name}" <${mailbox}>` : (this.config.get<string>('mail.from') ?? ''),
      };
    }
    const host = this.config.get<string>('mail.host') || null;
    return {
      source: host ? 'environment' : 'none',
      host,
      port: this.config.get<number>('mail.port') ?? 587,
      user: this.config.get<string>('mail.user') || null,
      pass: this.config.get<string>('mail.pass') ?? null,
      passwordUnreadable: false,
      from: this.config.get<string>('mail.from') ?? '',
    };
  }

  /** A transporter for the login in force, reused until the login changes. */
  private transportFor(r: ResolvedMail): nodemailer.Transporter | null {
    if (!r.host) return null;
    const key = [r.host, r.port, r.user, r.pass].join('\u0000');
    if (this.cached?.key !== key) {
      this.cached = {
        key,
        transporter: nodemailer.createTransport({
          host: r.host,
          port: r.port,
          secure: r.port === 465,
          auth: r.user ? { user: r.user, pass: r.pass ?? undefined } : undefined,
          // nodemailer waits two minutes by default. A firewalled mail port
          // drops packets rather than refusing them, so without these a broken
          // setup looks like a hang rather than an error.
          connectionTimeout: 15_000,
          greetingTimeout: 15_000,
          socketTimeout: 30_000,
        }),
      };
    }
    return this.cached.transporter;
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
    // Unawaited, and Node 22 kills the process on an unhandled rejection —
    // so the catch stays, in case anything in the check ever does throw.
    void this.reportStatus().catch((err) =>
      this.logger.error(`SMTP check could not run: ${err instanceof Error ? err.message : err}`),
    );
  }

  /** The boot-time log line: whether email works, and which settings it is using. */
  async reportStatus(): Promise<void> {
    const r = await this.resolve();
    if (!r.host) {
      this.logger.warn(
        'SMTP_HOST is not set — password reset emails are NOT being sent. ' +
          'The reset link is written to this log instead.',
      );
      return;
    }
    // verifyConnection already turns errors into a result.
    const result = await this.verifyConnection();
    const origin = r.source === 'console' ? 'settings saved in the console' : 'server environment';
    if (result.ok) {
      this.logger.log(`SMTP ready — ${r.user} via ${r.host}:${r.port} (${origin})`);
    } else {
      this.logger.error(`SMTP check failed (${origin}) — password reset emails will not arrive: ${result.reason}`);
    }
  }

  /**
   * Resolves true once the mail server has accepted the message, false when
   * SMTP is not configured (nothing was sent), and rejects if the server
   * refuses it. Most callers ignore the result; the platform-admin invite
   * uses it to tell the person inviting what actually happened.
   */
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
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

    const resolved = await this.resolve();
    const transporter = this.transportFor(resolved);
    if (!transporter) {
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
        return false;
      }
      this.logger.warn(`[DEV] Password reset link for ${to}: ${resetUrl}`);
      return false;
    }

    await transporter.sendMail({ from: resolved.from, to, subject, html, text });
    return true;
  }

  /**
   * The mail setup as the server sees it — never the password — plus anything
   * that is likely to stop mail arriving. For the platform console's email
   * check, so a misconfiguration can be seen without reading container logs.
   */
  async describe(): Promise<MailSetup> {
    const r = await this.resolve();
    const host = r.host;
    const user = r.user;
    const from = r.from;
    const appUrl = this.config.get<string>('mail.appUrl') || '';
    const production = this.config.get<string>('nodeEnv') === 'production';
    // Which knob to turn depends on where the settings came from.
    const fromKnob = r.source === 'console' ? 'the From address' : 'SMTP_FROM';

    const warnings: string[] = [];
    if (!host) warnings.push('No mail server is set, so no email can be sent at all. Add one under Settings → Email, or set SMTP_HOST.');
    if (host && !user) warnings.push('There is no mail login set. Most mail servers refuse to send without logging in.');
    if (r.passwordUnreadable) {
      warnings.push("The saved mail password can no longer be read (the server's secret key changed). Type the password in again and save.");
    }
    if (/@nghome\.app/i.test(from)) {
      warnings.push(
        `The sender is the placeholder no-reply@nghome.app. Mail is sent as a domain you do not own, which many providers reject or put in spam. Set ${fromKnob} to an address on your own domain.`,
      );
    }
    // The login is a mailbox and the From is on a different domain: servers
    // that only relay for their own domains refuse this (or spam-fold it).
    const fromDomain = addressOf(from)?.split('@')[1]?.toLowerCase();
    const loginDomain = addressOf(user)?.split('@')[1]?.toLowerCase();
    if (fromDomain && loginDomain && fromDomain !== loginDomain && !/@nghome\.app/i.test(from)) {
      warnings.push(
        `Mail is sent from ${fromDomain} but the server logs in as ${loginDomain}. Many providers only allow their own domain as the sender; if reset emails do not arrive, set ${fromKnob} to an address on ${loginDomain} (or verify ${fromDomain} with your provider).`,
      );
    }
    if (production && /localhost|127.0.0.1/.test(appUrl)) {
      warnings.push('APP_URL points at localhost, so the link inside every reset email would not open. Set APP_URL to your web address.');
    }

    return {
      source: r.source,
      configured: !!host,
      host,
      port: host ? r.port : null,
      user: maskEmail(user),
      from,
      appUrl,
      warnings,
    };
  }

  /** Sends a short plain message to one address and reports what the mail server said. */
  async sendTest(to: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const resolved = await this.resolve();
    const transporter = this.transportFor(resolved);
    if (!transporter) return { ok: false, reason: 'No mail server is set' };
    try {
      await transporter.sendMail({
        from: resolved.from,
        to,
        subject: 'NG Home email test',
        text: 'This is a test message from NG Home. If you can read it, the server can send email.',
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    }
  }

  /**
   * Checks the SMTP login without sending anything. Used by
   * scripts/check-smtp.ts so credentials can be proven before a real user's
   * reset depends on them. Returns why it failed rather than throwing, so the
   * caller can report it plainly.
   */
  async verifyConnection(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const transporter = this.transportFor(await this.resolve());
    if (!transporter) return { ok: false, reason: 'No mail server is set' };
    try {
      await transporter.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
