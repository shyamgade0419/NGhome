import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../mail/secret-box';
import { GatewayCreds } from './openwa.client';

const SETTINGS_ID = 'singleton';
/** How long a read of the settings is reused. Saving clears it at once on the server that saved. */
const CACHE_MS = 10_000;

export interface WhatsappSettingsInput {
  url: string;
  /** Blank or missing keeps the saved key; required the first time. */
  apiKey?: string | null;
}

/** What the console shows back. The key is never in here, only whether one is saved. */
export interface WhatsappSettingsView {
  /** Where the gateway address and key actually come from right now. */
  source: 'console' | 'environment' | 'none';
  url: string | null;
  hasKey: boolean;
  /** A key is saved but cannot be read with the current secret, so it must be typed again. */
  keyUnreadable: boolean;
  /** The server-environment gateway, shown so it is clear what "use the environment" falls back to. */
  environment: { url: string | null; hasKey: boolean };
  updatedAt: Date | null;
}

/** `http://openwa:2785/` → `http://openwa:2785`. Throws a plain-language error for anything that is not a web address. */
export function normalizeGatewayUrl(raw: string): string {
  const text = raw.trim();
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new BadRequestException('Enter the gateway address like http://openwa:2785 (with http:// or https://).');
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) {
    throw new BadRequestException('Enter the gateway address like http://openwa:2785 (with http:// or https://), without a login in it.');
  }
  // Only where it lives: the paths are added by the app. A pasted "/api" or "/api/docs" is dropped.
  return `${u.protocol}//${u.host}`;
}

/**
 * The WhatsApp gateway's address and key, saved from the platform console. It wins over the WHATSAPP_API_URL and
 * WHATSAPP_API_KEY environment variables when present, so the gateway can be set up, and fixed, without a redeploy;
 * removing it falls back to them.
 *
 * It is the platform's alone: one gateway serves every society, but each society links its own number as its own
 * session on it (Society.whatsappSessionId), so no society ever sees or uses another's number.
 */
@Injectable()
export class WhatsappSettingsStore {
  private readonly logger = new Logger(WhatsappSettingsStore.name);
  private cache?: { at: number; creds: GatewayCreds | null };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.get<string>('settingsEncryptionKey') || this.config.get<string>('jwt.accessSecret') || 'default-access-secret';
  }

  invalidate() {
    this.cache = undefined;
  }

  /** The gateway's address and key, or null when WhatsApp has not been set up on this platform. */
  async creds(): Promise<GatewayCreds | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.creds;
    const row = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    let creds: GatewayCreds | null = null;
    if (row) {
      const key = decryptSecret(row.apiKeyEnc, this.secret);
      if (key === null) {
        this.logger.error(
          'The WhatsApp API key saved in the console cannot be decrypted — SETTINGS_ENCRYPTION_KEY (or JWT_ACCESS_SECRET) has changed ' +
            'since it was saved. Type the key in again in the platform console under Settings → WhatsApp.',
        );
      } else {
        creds = { url: row.url, key };
      }
    } else {
      const url = process.env.WHATSAPP_API_URL?.trim().replace(/\/+$/, '');
      const key = process.env.WHATSAPP_API_KEY?.trim();
      creds = url && key ? { url, key } : null;
    }
    this.cache = { at: Date.now(), creds };
    return creds;
  }

  async view(): Promise<WhatsappSettingsView> {
    const row = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    const envUrl = process.env.WHATSAPP_API_URL?.trim() || null;
    const envKey = process.env.WHATSAPP_API_KEY?.trim() || null;
    const keyUnreadable = row ? decryptSecret(row.apiKeyEnc, this.secret) === null : false;
    return {
      source: row ? 'console' : envUrl && envKey ? 'environment' : 'none',
      url: row?.url ?? null,
      hasKey: !!row,
      keyUnreadable,
      environment: { url: envUrl, hasKey: !!envKey },
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async save(input: WhatsappSettingsInput, actorId: string): Promise<WhatsappSettingsView> {
    const url = normalizeGatewayUrl(input.url ?? '');
    const existing = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    const typed = input.apiKey && input.apiKey.trim().length > 0 ? input.apiKey.trim() : null;
    if (!typed && !existing) throw new BadRequestException("Enter the gateway's API key.");
    const apiKeyEnc = typed ? encryptSecret(typed, this.secret) : (existing as { apiKeyEnc: string }).apiKeyEnc;

    const data = { url, apiKeyEnc, updatedById: actorId };
    await this.prisma.platformWhatsappSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
    this.invalidate();
    await this.audit(actorId, existing ? { url: existing.url } : null, { url, keyChanged: !!typed });
    return this.view();
  }

  /** Forgets the console settings so WhatsApp goes back to the server's WHATSAPP_* environment variables. */
  async clear(actorId: string): Promise<WhatsappSettingsView> {
    const existing = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (existing) {
      await this.prisma.platformWhatsappSettings.delete({ where: { id: SETTINGS_ID } });
      this.invalidate();
      await this.audit(actorId, { url: existing.url }, { removed: true });
    }
    return this.view();
  }

  private async audit(actorId: string, oldValues: Record<string, unknown> | null, newValues: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: AuditAction.CONFIG_CHANGED,
        entityType: 'PlatformWhatsappSettings',
        entityId: SETTINGS_ID,
        oldValues: oldValues ? (oldValues as Prisma.InputJsonValue) : Prisma.JsonNull,
        // Never the key — only that it was replaced.
        newValues: newValues as Prisma.InputJsonValue,
      },
    });
  }
}
