import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addressOf } from '../config/configuration';
import { decryptSecret, encryptSecret } from './secret-box';

const SETTINGS_ID = 'singleton';

export interface MailSettingsInput {
  host: string;
  port: number;
  username?: string | null;
  /** Blank or missing keeps the saved password; required the first time. */
  password?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
}

/** What the console shows back. The password is never in here, only whether one is saved. */
export interface MailSettingsView {
  /** Where mail is actually sent from right now. */
  source: 'console' | 'environment' | 'none';
  host: string | null;
  port: number | null;
  username: string | null;
  fromAddress: string | null;
  fromName: string | null;
  hasPassword: boolean;
  /** A password is saved but cannot be read with the current key, so it must be typed again. */
  passwordUnreadable: boolean;
  /** The server-environment login, shown so it is clear what "use the environment" falls back to. */
  environment: { host: string | null; port: number | null; user: string | null };
  updatedAt: Date | null;
}

/** The saved console settings with the password decrypted — for the mail service only. */
export interface StoredMailSettings {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  passwordUnreadable: boolean;
  fromAddress: string | null;
  fromName: string | null;
}

const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

/**
 * The mail login saved from the platform console. It wins over the SMTP_*
 * environment variables when present, so mail can be fixed without a redeploy;
 * removing it falls back to them.
 */
@Injectable()
export class MailSettingsStore {
  private readonly logger = new Logger(MailSettingsStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return (
      this.config.get<string>('settingsEncryptionKey') ||
      this.config.get<string>('jwt.accessSecret') ||
      'default-access-secret'
    );
  }

  /** The saved settings with the password decrypted, or null when none are saved. */
  async load(): Promise<StoredMailSettings | null> {
    const row = await this.prisma.platformMailSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!row) return null;
    let password: string | null = null;
    let passwordUnreadable = false;
    if (row.passwordEnc) {
      password = decryptSecret(row.passwordEnc, this.secret);
      if (password === null) {
        passwordUnreadable = true;
        this.logger.error(
          'The mail password saved in the console cannot be decrypted — SETTINGS_ENCRYPTION_KEY (or JWT_ACCESS_SECRET) ' +
            'has changed since it was saved. Type the password in again under Settings → Email.',
        );
      }
    }
    return {
      host: row.host,
      port: row.port,
      username: row.username,
      password,
      passwordUnreadable,
      fromAddress: row.fromAddress,
      fromName: row.fromName,
    };
  }

  async view(): Promise<MailSettingsView> {
    const row = await this.prisma.platformMailSettings.findUnique({ where: { id: SETTINGS_ID } });
    const stored = row ? await this.load() : null;
    const envHost = this.config.get<string>('mail.host') || null;
    return {
      source: row ? 'console' : envHost ? 'environment' : 'none',
      host: row?.host ?? null,
      port: row?.port ?? null,
      username: row?.username ?? null,
      fromAddress: row?.fromAddress ?? null,
      fromName: row?.fromName ?? null,
      hasPassword: !!row?.passwordEnc,
      passwordUnreadable: stored?.passwordUnreadable ?? false,
      environment: {
        host: envHost,
        port: envHost ? (this.config.get<number>('mail.port') ?? null) : null,
        user: this.config.get<string>('mail.user') || null,
      },
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async save(input: MailSettingsInput, actorId: string): Promise<MailSettingsView> {
    const host = clean(input.host);
    if (!host || /[\s/]/.test(host)) {
      throw new BadRequestException('Enter the mail server name only, like smtp.example.com — no spaces, https:// or path.');
    }
    const username = clean(input.username);
    const fromAddress = clean(input.fromAddress);
    if (fromAddress && !addressOf(fromAddress)) {
      throw new BadRequestException('The From address must be an email address like support@example.com.');
    }

    const existing = await this.prisma.platformMailSettings.findUnique({ where: { id: SETTINGS_ID } });
    const typed = input.password && input.password.length > 0 ? input.password : null;
    if (!typed && !existing?.passwordEnc && username) {
      throw new BadRequestException('Enter the password for this mail login.');
    }
    const passwordEnc = typed ? encryptSecret(typed, this.secret) : (existing?.passwordEnc ?? null);

    const data = { host, port: input.port, username, passwordEnc, fromAddress, fromName: clean(input.fromName), updatedById: actorId };
    await this.prisma.platformMailSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: AuditAction.CONFIG_CHANGED,
        entityType: 'PlatformMailSettings',
        entityId: SETTINGS_ID,
        oldValues: existing ? ({ host: existing.host, port: existing.port, username: existing.username } as Prisma.InputJsonValue) : Prisma.JsonNull,
        // Never the password — only that it was replaced.
        newValues: { host, port: input.port, username, passwordChanged: !!typed } as Prisma.InputJsonValue,
      },
    });

    return this.view();
  }

  /** Forgets the console settings so mail goes back to the server's SMTP_* environment variables. */
  async clear(actorId: string): Promise<MailSettingsView> {
    const existing = await this.prisma.platformMailSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (existing) {
      await this.prisma.platformMailSettings.delete({ where: { id: SETTINGS_ID } });
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action: AuditAction.CONFIG_CHANGED,
          entityType: 'PlatformMailSettings',
          entityId: SETTINGS_ID,
          oldValues: { host: existing.host, port: existing.port, username: existing.username } as Prisma.InputJsonValue,
          newValues: { removed: true } as Prisma.InputJsonValue,
        },
      });
    }
    return this.view();
  }
}
