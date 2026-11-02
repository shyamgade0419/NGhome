import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GatewayCreds, GatewayError, createSession, deleteSession, getQr, getSession, listSessions, logoutSession, startSession, stopSession,
} from './openwa.client';
import { WhatsappSettingsStore } from './whatsapp-settings.store';

/** What a society sees while it links its number, or afterwards to say it is still linked. */
export interface ConnectionState {
  /** The platform has a gateway set up. */
  hasGateway: boolean;
  /** The platform owner has allowed this society to use WhatsApp. */
  allowed: boolean;
  /** This society has a session of its own on the gateway (it pressed Connect at least once). */
  linked: boolean;
  /** The gateway's state for this society's session; `ready` means its number is linked and messages can go out. */
  status: string | null;
  /** The society's own WhatsApp number, once connected. */
  phone: string | null;
  /** The QR code to scan, as an image, while the session is waiting for one. */
  qrCode: string | null;
  /** Why the gateway could not be asked, in plain words. */
  problem: string | null;
}

/** The name of a society's session on the gateway: one per society, so two societies never share a number. */
export const sessionNameFor = (societyId: string): string => `ng-${societyId}`;

interface SocietyRow {
  whatsappAllowed: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  whatsappSessionId: string | null;
}

const isAllowed = (s: SocietyRow | null): boolean => !!s && s.whatsappAllowed && s.isActive && !s.deletedAt;

/**
 * Links a society's own WhatsApp number to the gateway: finds or creates that society's session, starts it, and hands
 * back the QR code to scan. Each society has a session of its own, so its messages go out from its number only, and a
 * society can never reach another's session: the session id always comes from the society's own row, never from the
 * request.
 */
@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger(WhatsappConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WhatsappSettingsStore,
  ) {}

  private society(societyId: string): Promise<SocietyRow | null> {
    return this.prisma.society.findUnique({
      where: { id: societyId },
      select: { whatsappAllowed: true, isActive: true, deletedAt: true, whatsappSessionId: true },
    });
  }

  async state(societyId: string): Promise<ConnectionState> {
    const [creds, society] = await Promise.all([this.settings.creds(), this.society(societyId)]);
    const allowed = isAllowed(society);
    const sessionId = society?.whatsappSessionId ?? null;
    const base: ConnectionState = { hasGateway: !!creds, allowed, linked: !!sessionId, status: null, phone: null, qrCode: null, problem: null };
    if (!creds || !allowed || !sessionId) return base;
    try {
      const session = await getSession(creds, sessionId);
      let qrCode: string | null = null;
      if (session.status === 'qr_ready') qrCode = (await getQr(creds, sessionId).catch(() => ({ qrCode: null }))).qrCode;
      return { ...base, status: session.status, phone: session.phone, qrCode };
    } catch (err) {
      return { ...base, problem: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Get this society's session going so a QR code appears (or, if the phone is still linked, so it reconnects without
   * one). Safe to press again: the society's session is reused, never duplicated.
   */
  async connect(societyId: string): Promise<ConnectionState> {
    const [creds, society] = await Promise.all([this.settings.creds(), this.society(societyId)]);
    if (!creds) throw new BadRequestException('WhatsApp has not been set up on this platform yet. Ask the platform owner.');
    if (!isAllowed(society)) {
      throw new ForbiddenException('WhatsApp messages are not switched on for your society. Ask the platform owner to allow them.');
    }
    let sessionId = (society as SocietyRow).whatsappSessionId;

    try {
      if (sessionId) {
        // A saved id the gateway no longer knows (it was reset) is replaced rather than failing for ever.
        const known = await getSession(creds, sessionId).catch((e: GatewayError) => (e.status === 404 ? null : Promise.reject(e)));
        if (!known) sessionId = null;
      }
      if (!sessionId) {
        const name = sessionNameFor(societyId);
        const existing = (await listSessions(creds)).find((s) => s.name === name);
        const found = existing ?? (await createSession(creds, name));
        // Claim it for this society only if nobody else did meanwhile (two taps at once).
        const claimed = await this.prisma.society.updateMany({
          where: { id: societyId, OR: [{ whatsappSessionId: null }, { whatsappSessionId: (society as SocietyRow).whatsappSessionId }] },
          data: { whatsappSessionId: found.id },
        });
        sessionId = claimed.count === 1 ? found.id : ((await this.society(societyId))?.whatsappSessionId ?? found.id);
      }
      await this.startQuietly(creds, sessionId);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    return this.state(societyId);
  }

  /** Unlinks this society's phone from the gateway. The next Connect shows a new QR code. */
  async disconnect(societyId: string): Promise<ConnectionState> {
    const [creds, society] = await Promise.all([this.settings.creds(), this.society(societyId)]);
    if (creds && society?.whatsappSessionId) {
      try {
        await logoutSession(creds, society.whatsappSessionId);
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
    }
    return this.state(societyId);
  }

  /**
   * Free the memory a society's session uses when the society is stopped, suspended or removed. `stop` keeps the link to
   * the phone (it comes back when the society is allowed again); `delete` removes the session altogether. Best-effort: it
   * must never make stopping or removing a society fail.
   */
  async release(societyId: string, mode: 'stop' | 'delete'): Promise<void> {
    try {
      const [creds, society] = await Promise.all([this.settings.creds(), this.society(societyId)]);
      const sessionId = society?.whatsappSessionId;
      if (!creds || !sessionId) return;
      if (mode === 'stop') {
        await stopSession(creds, sessionId);
      } else {
        await deleteSession(creds, sessionId);
        await this.prisma.society.updateMany({ where: { id: societyId }, data: { whatsappSessionId: null } });
      }
    } catch (err) {
      this.logger.warn(`Releasing the WhatsApp session of society ${societyId} (${mode}) failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Removes a session by id once its society has been erased for good (the society's row, and its id, are gone by then). */
  async deleteSessionById(sessionId: string | null | undefined): Promise<void> {
    if (!sessionId) return;
    try {
      const creds = await this.settings.creds();
      if (creds) await deleteSession(creds, sessionId);
    } catch (err) {
      this.logger.warn(`Removing WhatsApp session ${sessionId} of an erased society failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * For the platform owner: every society that has linked a number, whether it is connected, and any session on the
   * gateway that belongs to no society (left behind, using memory for nothing). Societies that send through their own
   * Meta account are listed too, marked `cloud`: they use nothing on the gateway.
   */
  async overview() {
    const creds = await this.settings.creds();
    const societies = await this.prisma.society.findMany({
      where: { whatsappSessionId: { not: null } },
      select: { id: true, name: true, displayName: true, whatsappAllowed: true, whatsappSessionId: true, whatsappProvider: true, deletedAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const cloudRows = await this.prisma.societyWhatsappCloud.findMany({ select: { societyId: true, displayPhone: true } });
    const cloudSocieties = (
      await this.prisma.society.findMany({
        where: { id: { in: cloudRows.map((c) => c.societyId) }, whatsappProvider: 'CLOUD' },
        select: { id: true, name: true, displayName: true, whatsappAllowed: true, deletedAt: true },
        orderBy: { createdAt: 'asc' },
      })
    ).map((c) => ({
      societyId: c.id,
      name: c.displayName ?? c.name,
      allowed: c.whatsappAllowed,
      deleted: !!c.deletedAt,
      provider: 'CLOUD' as const,
      status: 'cloud' as string | null,
      phone: cloudRows.find((r) => r.societyId === c.id)?.displayPhone ?? null,
    }));
    if (!creds) return { configured: false, reachable: false, problem: null as string | null, sessions: [], cloud: cloudSocieties, orphans: [] };
    let live: Awaited<ReturnType<typeof listSessions>> = [];
    let problem: string | null = null;
    try {
      live = await listSessions(creds);
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    const byId = new Map(live.map((s) => [s.id, s]));
    const owned = new Set(societies.map((s) => s.whatsappSessionId));
    return {
      configured: true,
      reachable: problem === null,
      problem,
      sessions: societies.map((s) => ({
        societyId: s.id,
        name: s.displayName ?? s.name,
        allowed: s.whatsappAllowed,
        deleted: !!s.deletedAt,
        // A society that moved to its Meta account keeps its linked number (stopped) but sends through Meta.
        provider: s.whatsappProvider === 'CLOUD' ? ('CLOUD' as const) : ('OPENWA' as const),
        status: problem ? null : (byId.get(s.whatsappSessionId as string)?.status ?? 'missing'),
        phone: byId.get(s.whatsappSessionId as string)?.phone ?? null,
      })),
      cloud: cloudSocieties,
      orphans: live.filter((s) => !owned.has(s.id)).map((s) => ({ id: s.id, name: s.name, status: s.status, phone: s.phone })),
    };
  }

  /**
   * Start the session without making the page wait for it: the gateway opens WhatsApp in a browser, which takes a
   * while. The page polls the state, so it shows the QR code the moment it exists. An "already started" refusal is fine.
   */
  private async startQuietly(creds: GatewayCreds, sessionId: string): Promise<void> {
    const started = startSession(creds, sessionId).catch((e: GatewayError) => {
      if (e.status !== 409) throw e;
    });
    await Promise.race([started, new Promise((r) => setTimeout(r, 20_000))]);
    // If it is still running after the wait, a later failure is reported by the next state() call.
    started.catch(() => undefined);
  }
}
