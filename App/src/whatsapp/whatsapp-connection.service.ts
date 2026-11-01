import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GatewayCreds, GatewayError, createSession, getQr, getSession, listSessions, logoutSession, startSession,
} from './openwa.client';
import { WhatsappSettingsStore } from './whatsapp-settings.store';

/** What the platform console shows while a phone is being linked, or afterwards to say it is still linked. */
export interface ConnectionState {
  /** The gateway address and key are saved (or in the environment). */
  hasGateway: boolean;
  sessionId: string | null;
  /** The gateway's session state; `ready` means a phone is linked and messages can go out. */
  status: string | null;
  /** The linked WhatsApp number, once connected. */
  phone: string | null;
  /** The QR code to scan, as an image, while the session is waiting for one. */
  qrCode: string | null;
  /** Why the gateway could not be asked, in plain words. */
  problem: string | null;
}

/** The name given to the session this app creates on the gateway. */
export const SESSION_NAME = 'nghome';

/**
 * Links the platform's WhatsApp number to the gateway from the console: finds or creates the session, starts it, and
 * hands back the QR code to scan. Replaces opening the gateway's own dashboard.
 */
@Injectable()
export class WhatsappConnectionService {
  constructor(private readonly settings: WhatsappSettingsStore) {}

  async state(): Promise<ConnectionState> {
    const creds = await this.settings.creds();
    const view = await this.settings.view();
    const sessionId = view.source === 'console' ? view.sessionId : view.environment.sessionId;
    const base: ConnectionState = { hasGateway: !!creds, sessionId, status: null, phone: null, qrCode: null, problem: null };
    if (!creds || !sessionId) return base;
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
   * Get a session going so a QR code appears (or, if the phone is still linked, so it reconnects without one). Safe to
   * press again: an existing session is reused, never duplicated.
   */
  async connect(actorId: string): Promise<ConnectionState> {
    const creds = await this.settings.creds();
    if (!creds) throw new BadRequestException('Save the gateway address and API key first.');
    const view = await this.settings.view();
    let sessionId = view.source === 'console' ? view.sessionId : view.environment.sessionId;

    try {
      if (sessionId) {
        // A saved id the gateway no longer knows (it was reset) is replaced rather than failing for ever.
        const known = await getSession(creds, sessionId).catch((e: GatewayError) => (e.status === 404 ? null : Promise.reject(e)));
        if (!known) sessionId = null;
      }
      if (!sessionId) {
        const existing = (await listSessions(creds)).find((s) => s.name === SESSION_NAME);
        sessionId = (existing ?? (await createSession(creds, SESSION_NAME))).id;
        if (view.source === 'console') await this.settings.setSessionId(sessionId, actorId);
      }
      await this.startQuietly(creds, sessionId);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    return this.state();
  }

  /** Unlinks the phone from the gateway. The next Connect shows a new QR code. */
  async disconnect(): Promise<ConnectionState> {
    const creds = await this.settings.creds();
    const view = await this.settings.view();
    const sessionId = view.source === 'console' ? view.sessionId : view.environment.sessionId;
    if (creds && sessionId) {
      try {
        await logoutSession(creds, sessionId);
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
    }
    return this.state();
  }

  /**
   * Start the session without making the page wait for it: the gateway opens WhatsApp in a browser, which takes a
   * while. The console polls the state, so it shows the QR code the moment it exists. A "already started" refusal is fine.
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
