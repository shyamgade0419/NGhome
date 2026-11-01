import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../mail/secret-box';
import { GatewayConfig, GatewayCreds, readGatewayConfig } from './openwa.client';

const SETTINGS_ID = 'singleton';
/** How long a read of the settings is reused. Saving clears it at once on the server that saved. */
const CACHE_MS = 10_000;

export interface WhatsappSettingsInput {
  url: string;
  /** Blank or missing keeps the saved key; required the first time. */
  apiKey?: string | null;
  sessionId?: string | null;
}

/** What the console shows back. The key is never in here, only whether one is saved. */
export interface WhatsappSettingsView {
  /** Where the connection actually comes from right now. */
  source: 'console' | 'environment' | 'none';
  url: string | null;
  hasKey: boolean;
  /** A key is saved but cannot be read with the current secret, so it must be typed again. */
  keyUnreadable: boolean;
  sessionId: string | null;
  /** The server-environment connection, shown so it is clear what "use the environment" falls back to. */
  environment: { url: string | null; hasKey: boolean; sessionId: string | null };
  updatedAt: Date | null;
}

const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

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
 * The WhatsApp gateway connection saved from the platform console. It wins over the WHATSAPP_* environment variables
 * when present, so WhatsApp can be set up, and fixed, without a redeploy; removing it falls back to them.
 */
@Injectable()
export class WhatsappSettingsStore {
  private readonly logger = new Logger(WhatsappSettingsStore.name);
  private cache?: { at: number; creds: GatewayCreds | null; effective: GatewayConfig | null };

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

  private async resolve() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const row = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    let creds: GatewayCreds | null = null;
    let effective: GatewayConfig | null = null;
    if (row) {
      const key = decryptSecret(row.apiKeyEnc, this.secret);
      if (key === null) {
        this.logger.error(
          'The WhatsApp API key saved in the console cannot be decrypted — SETTINGS_ENCRYPTION_KEY (or JWT_ACCESS_SECRET) has changed ' +
            'since it was saved. Type the key in again in the platform console under Settings → WhatsApp.',
        );
      } else {
        creds = { url: row.url, key };
        effective = row.sessionId ? { url: row.url, key, sessionId: row.sessionId } : null;
      }
    } else {
      effective = readGatewayConfig();
      const url = process.env.WHATSAPP_API_URL?.trim().replace(/\/+$/, '');
      const key = process.env.WHATSAPP_API_KEY?.trim();
      creds = url && key ? { url, key } : null;
    }
    this.cache = { at: Date.now(), creds, effective };
    return this.cache;
  }

  /** The URL and key, whether or not a session has been chosen yet: what is needed to set a session up. */
  async creds(): Promise<GatewayCreds | null> {
    return (await this.resolve()).creds;
  }

  /** The full connection messages are sent through, or null when WhatsApp is not set up. */
  async effective(): Promise<GatewayConfig | null> {
    return (await this.resolve()).effective;
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
      sessionId: row?.sessionId ?? null,
      environment: { url: envUrl, hasKey: !!envKey, sessionId: process.env.WHATSAPP_SESSION_ID?.trim() || null },
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async save(input: WhatsappSettingsInput, actorId: string): Promise<WhatsappSettingsView> {
    const url = normalizeGatewayUrl(input.url ?? '');
    const existing = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    const typed = input.apiKey && input.apiKey.trim().length > 0 ? input.apiKey.trim() : null;
    if (!typed && !existing) throw new BadRequestException("Enter the gateway's API key.");
    const apiKeyEnc = typed ? encryptSecret(typed, this.secret) : (existing as { apiKeyEnc: string }).apiKeyEnc;
    // The session belongs to one gateway: pointing at a different address forgets it, unless one is given with it.
    const given = clean(input.sessionId);
    const sessionId = given ?? (existing && existing.url === url ? existing.sessionId : null);

    const data = { url, apiKeyEnc, sessionId, updatedById: actorId };
    await this.prisma.platformWhatsappSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
    this.invalidate();
    await this.audit(actorId, existing ? { url: existing.url, sessionId: existing.sessionId } : null, { url, sessionId, keyChanged: !!typed });
    return this.view();
  }

  /** The session the console created (or found) on the gateway. */
  async setSessionId(sessionId: string | null, actorId: string): Promise<void> {
    const existing = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!existing) throw new BadRequestException('Save the gateway address and API key first.');
    if (existing.sessionId === sessionId) return;
    await this.prisma.platformWhatsappSettings.update({ where: { id: SETTINGS_ID }, data: { sessionId, updatedById: actorId } });
    this.invalidate();
    await this.audit(actorId, { sessionId: existing.sessionId }, { sessionId });
  }

  /** Forgets the console settings so WhatsApp goes back to the server's WHATSAPP_* environment variables. */
  async clear(actorId: string): Promise<WhatsappSettingsView> {
    const existing = await this.prisma.platformWhatsappSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (existing) {
      await this.prisma.platformWhatsappSettings.delete({ where: { id: SETTINGS_ID } });
      this.invalidate();
      await this.audit(actorId, { url: existing.url, sessionId: existing.sessionId }, { removed: true });
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
