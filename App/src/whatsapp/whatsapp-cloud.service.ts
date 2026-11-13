import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../mail/secret-box';
import { GatewayError } from './openwa.client';
import { CloudCreds, CloudTemplateStatus, createTemplate, getPhoneNumber, listTemplates } from './whatsapp-cloud.client';
import { CLOUD_TEMPLATES } from './whatsapp-cloud-templates';
import { WhatsappConnectionService } from './whatsapp-connection.service';

export type WhatsappProvider = 'OPENWA' | 'CLOUD';

export interface ConnectCloudInput {
  phoneNumberId: string;
  /** Blank keeps the saved token; required the first time. */
  accessToken?: string | null;
  wabaId?: string | null;
}

export interface CloudTemplateView {
  kind: string;
  name: string;
  /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED ... as Meta reports it; NOT_SUBMITTED when it has not been sent for approval. */
  status: string;
  reason: string | null;
  /** Not needed to send; once approved it adds to a message (the receipt link on the payment confirmation). */
  optional?: boolean;
}

/** What a society sees about its Meta account. The access token is never in here, only whether one is saved. */
export interface CloudState {
  /** The platform owner has allowed this society to use WhatsApp (the same switch that governs a linked number). */
  allowed: boolean;
  provider: WhatsappProvider;
  /** A Meta account is connected (a phone number id and a token are saved). */
  linked: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  /** The business number messages go out from, digits with the country code. */
  displayPhone: string | null;
  verifiedName: string | null;
  /** `ready` when Meta accepts the token, `token_invalid` when it does not, `error` when Meta could not be asked. */
  status: 'ready' | 'token_invalid' | 'error' | null;
  problem: string | null;
  templates: CloudTemplateView[];
  /** Every required template approved (the optional ones do not count); null when that cannot be known (no Business Account ID entered). */
  templatesReady: boolean | null;
}

/** How long Meta's answer about an account is reused, so a page that refreshes often does not call Meta each time. */
const CACHE_MS = 45_000;

const isAllowed = (s: { whatsappAllowed: boolean; isActive: boolean; deletedAt: Date | null } | null) => !!s && s.whatsappAllowed && s.isActive && !s.deletedAt;

/**
 * A society's own Meta WhatsApp Business Cloud API account: connect it, check it, submit the four message templates, and
 * choose between it and a linked OpenWA number. The access token is stored encrypted and never leaves the server; every
 * call works on the society in the caller's token and nothing in a request can name another society's account.
 */
@Injectable()
export class WhatsappCloudService {
  private readonly logger = new Logger(WhatsappCloudService.name);
  private readonly cache = new Map<string, { at: number; value: CloudState }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connection: WhatsappConnectionService,
  ) {}

  private get secret(): string {
    return this.config.get<string>('settingsEncryptionKey') || this.config.get<string>('jwt.accessSecret') || 'default-access-secret';
  }

  private society(societyId: string) {
    return this.prisma.society.findUnique({
      where: { id: societyId },
      select: { whatsappAllowed: true, isActive: true, deletedAt: true, whatsappProvider: true },
    });
  }

  /** The society's Meta credentials, or null when none are saved or the token can no longer be read. */
  async creds(societyId: string): Promise<(CloudCreds & { displayPhone: string | null }) | null> {
    const row = await this.prisma.societyWhatsappCloud.findUnique({ where: { societyId } });
    if (!row) return null;
    const accessToken = decryptSecret(row.accessTokenEnc, this.secret);
    if (accessToken === null) {
      this.logger.error(`The Meta access token saved for society ${societyId} cannot be decrypted — SETTINGS_ENCRYPTION_KEY (or JWT_ACCESS_SECRET) has changed since it was saved. Its admin must connect again.`);
      return null;
    }
    return { phoneNumberId: row.phoneNumberId, accessToken, wabaId: row.wabaId, displayPhone: row.displayPhone };
  }

  /** Whether a Meta account is connected; cheap, no call to Meta. */
  async isLinked(societyId: string): Promise<boolean> {
    return (await this.prisma.societyWhatsappCloud.count({ where: { societyId } })) > 0;
  }

  invalidate(societyId: string) {
    this.cache.delete(societyId);
  }

  /** Everything the settings screen shows. Asks Meta (at most once every 45 seconds per society) unless `fresh`. */
  async state(societyId: string, fresh = false): Promise<CloudState> {
    const hit = this.cache.get(societyId);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const [society, row] = await Promise.all([this.society(societyId), this.prisma.societyWhatsappCloud.findUnique({ where: { societyId } })]);
    const base: CloudState = {
      allowed: isAllowed(society),
      provider: society?.whatsappProvider === 'CLOUD' ? 'CLOUD' : 'OPENWA',
      linked: !!row,
      phoneNumberId: row?.phoneNumberId ?? null,
      wabaId: row?.wabaId ?? null,
      displayPhone: row?.displayPhone ?? null,
      verifiedName: row?.verifiedName ?? null,
      status: null,
      problem: null,
      templates: CLOUD_TEMPLATES.map((t) => ({ kind: t.kind, name: t.name, status: row?.wabaId ? 'NOT_SUBMITTED' : 'UNKNOWN', reason: null, optional: t.optional === true })),
      templatesReady: null,
    };
    if (!row) return base;
    const creds = await this.creds(societyId);
    if (!creds) return { ...base, status: 'token_invalid', problem: 'The saved access token can no longer be read. Connect again with a new token.' };

    let value = base;
    try {
      const phone = await getPhoneNumber(creds);
      value = { ...value, status: 'ready', displayPhone: phone.displayPhone ?? value.displayPhone, verifiedName: phone.verifiedName ?? value.verifiedName };
    } catch (err) {
      const e = err instanceof GatewayError ? err : new GatewayError(err instanceof Error ? err.message : String(err));
      value = { ...value, status: e.gatewayDown && e.status !== undefined ? 'token_invalid' : 'error', problem: e.message };
    }
    if (value.status === 'ready' && creds.wabaId) {
      try {
        value = { ...value, ...this.withTemplates(await listTemplates(creds)) };
      } catch (err) {
        value = { ...value, problem: `Could not read the templates from Meta: ${err instanceof Error ? err.message : err}` };
      }
    }
    this.cache.set(societyId, { at: Date.now(), value });
    return value;
  }

  private withTemplates(live: CloudTemplateStatus[]): Pick<CloudState, 'templates' | 'templatesReady'> {
    const templates = CLOUD_TEMPLATES.map((t) => {
      const found = live.find((l) => l.name === t.name);
      return { kind: t.kind, name: t.name, status: found?.status ?? 'NOT_SUBMITTED', reason: found?.rejectedReason ?? null, optional: t.optional === true };
    });
    // Only the required templates decide whether messages can be sent; the optional ones just add to a message once approved.
    return { templates, templatesReady: templates.filter((t) => !t.optional).every((t) => t.status === 'APPROVED') };
  }

  /**
   * Save the society's Meta account after checking it with Meta, and start sending through it. Checks first, so a wrong
   * id or token is refused with Meta's own words instead of being saved and failing every message later.
   */
  async connect(societyId: string, input: ConnectCloudInput, actorId: string): Promise<CloudState> {
    const society = await this.society(societyId);
    if (!isAllowed(society)) {
      throw new ForbiddenException('WhatsApp messages are not switched on for your society. Ask the platform owner to allow them.');
    }
    const existing = await this.prisma.societyWhatsappCloud.findUnique({ where: { societyId } });
    const typed = input.accessToken && input.accessToken.trim().length > 0 ? input.accessToken.trim() : null;
    if (!typed && !existing) throw new BadRequestException('Enter the access token from your Meta account.');
    const phoneNumberId = input.phoneNumberId.trim();
    const wabaId = input.wabaId && input.wabaId.trim() !== '' ? input.wabaId.trim() : null;
    if (!/^\d{5,30}$/.test(phoneNumberId)) throw new BadRequestException('The Phone number ID is digits only, as shown in WhatsApp → API Setup in your Meta app.');
    if (wabaId !== null && !/^\d{5,30}$/.test(wabaId)) throw new BadRequestException('The WhatsApp Business Account ID is digits only.');

    const accessToken = typed ?? ((await this.creds(societyId))?.accessToken ?? null);
    if (!accessToken) throw new BadRequestException('Enter the access token from your Meta account.');
    let phone;
    try {
      phone = await getPhoneNumber({ phoneNumberId, accessToken });
    } catch (err) {
      throw new BadRequestException(`Meta did not accept these details: ${err instanceof Error ? err.message : err}`);
    }

    const data = {
      phoneNumberId,
      wabaId,
      accessTokenEnc: typed ? encryptSecret(typed, this.secret) : (existing as { accessTokenEnc: string }).accessTokenEnc,
      displayPhone: phone.displayPhone,
      verifiedName: phone.verifiedName,
      updatedById: actorId,
    };
    await this.prisma.societyWhatsappCloud.upsert({ where: { societyId }, create: { societyId, ...data }, update: data });
    this.invalidate(societyId);
    await this.audit(societyId, actorId, existing ? { phoneNumberId: existing.phoneNumberId } : null, { connected: true, phoneNumberId, tokenChanged: !!typed });
    // Connecting is choosing it: a society that connects its Meta account means to send through it.
    await this.setProvider(societyId, 'CLOUD', actorId);
    return this.state(societyId, true);
  }

  /** Forget the society's Meta account. Its messages go back to a linked OpenWA number (if it has one). */
  async disconnect(societyId: string, actorId: string): Promise<CloudState> {
    const existing = await this.prisma.societyWhatsappCloud.findUnique({ where: { societyId } });
    if (existing) {
      await this.prisma.societyWhatsappCloud.delete({ where: { societyId } });
      this.invalidate(societyId);
      await this.audit(societyId, actorId, { phoneNumberId: existing.phoneNumberId }, { removed: true });
    }
    await this.setProvider(societyId, 'OPENWA', actorId);
    return this.state(societyId, true);
  }

  /**
   * Choose how this society sends: a linked OpenWA number, or its Meta account. Whatever was still waiting is dropped when
   * the choice changes, because it was written for the other way (a template's blanks, or free text). Moving to Meta also
   * stops the society's OpenWA session, freeing its memory on the gateway; the link to the phone is kept.
   */
  async setProvider(societyId: string, provider: WhatsappProvider, actorId: string): Promise<CloudState> {
    const society = await this.society(societyId);
    if (provider === 'CLOUD') {
      if (!isAllowed(society)) throw new ForbiddenException('WhatsApp messages are not switched on for your society. Ask the platform owner to allow them.');
      if (!(await this.isLinked(societyId))) throw new BadRequestException('Connect your Meta WhatsApp Business account first.');
    }
    if ((society?.whatsappProvider ?? 'OPENWA') !== provider) {
      await this.prisma.society.update({ where: { id: societyId }, data: { whatsappProvider: provider } });
      const dropped = await this.prisma.whatsappMessage.updateMany({
        where: { societyId, status: { in: ['PENDING', 'SENDING'] }, kind: { not: 'TEST' } },
        data: { status: 'FAILED', lastError: 'The way WhatsApp messages are sent was changed before this one went out.' },
      });
      if (provider === 'CLOUD') await this.connection.release(societyId, 'stop');
      await this.prisma.auditLog.create({
        data: {
          societyId,
          actorId,
          action: AuditAction.CONFIG_CHANGED,
          entityType: 'Society',
          entityId: societyId,
          oldValues: { whatsappProvider: society?.whatsappProvider ?? 'OPENWA' } as Prisma.InputJsonValue,
          newValues: { whatsappProvider: provider, queuedMessagesDropped: dropped.count } as Prisma.InputJsonValue,
        },
      });
    }
    this.invalidate(societyId);
    return this.state(societyId, true);
  }

  /** Submit the templates that are not on the society's Meta account yet. Ones already there (any state) are left alone. */
  async submitTemplates(societyId: string): Promise<CloudState & { submitted: string[]; failed: { name: string; error: string }[] }> {
    const creds = await this.creds(societyId);
    if (!creds) throw new BadRequestException('Connect your Meta WhatsApp Business account first.');
    if (!creds.wabaId) throw new BadRequestException('Enter your WhatsApp Business Account ID first, so the templates can be created for you.');
    let live: CloudTemplateStatus[];
    try {
      live = await listTemplates(creds);
    } catch (err) {
      throw new BadRequestException(`Could not read the templates from Meta: ${err instanceof Error ? err.message : err}`);
    }
    const submitted: string[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const t of CLOUD_TEMPLATES) {
      if (live.some((l) => l.name === t.name)) continue;
      try {
        await createTemplate(creds, t);
        submitted.push(t.name);
      } catch (err) {
        failed.push({ name: t.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.invalidate(societyId);
    return { ...(await this.state(societyId, true)), submitted, failed };
  }

  private async audit(societyId: string, actorId: string, oldValues: Record<string, unknown> | null, newValues: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: {
        societyId,
        actorId,
        action: AuditAction.CONFIG_CHANGED,
        entityType: 'SocietyWhatsappCloud',
        entityId: societyId,
        oldValues: oldValues ? (oldValues as Prisma.InputJsonValue) : Prisma.JsonNull,
        // Never the token — only that it was replaced.
        newValues: newValues as Prisma.InputJsonValue,
      },
    });
  }
}
