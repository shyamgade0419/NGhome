/**
 * Talks to OpenWA, the self-hosted WhatsApp gateway (https://github.com/rmyndharis/OpenWA). It is an unofficial
 * client of WhatsApp, so the rest of the system treats it as something that can be slow, offline or logged out:
 * nothing here may fail a bill, a payment or a login.
 *
 * Connection settings are the platform's, from the environment, because one gateway session is one WhatsApp number:
 *   WHATSAPP_API_URL     e.g. http://openwa:2785
 *   WHATSAPP_API_KEY     the gateway's API key
 *   WHATSAPP_SESSION_ID  the id of the session that is logged in to the number to send from
 */

export interface GatewayConfig {
  url: string;
  key: string;
  sessionId: string;
}

export function readGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig | null {
  const url = env.WHATSAPP_API_URL?.trim().replace(/\/+$/, '');
  const key = env.WHATSAPP_API_KEY?.trim();
  const sessionId = env.WHATSAPP_SESSION_ID?.trim();
  return url && key && sessionId ? { url, key, sessionId } : null;
}

/** Why a send did not happen, and whether trying the same message again later can help. */
export class GatewayError extends Error {
  constructor(
    message: string,
    /** The HTTP status, absent when the gateway could not be reached at all. */
    readonly status?: number,
    /** The gateway or the session is not usable right now: stop sending, do not blame the message. */
    readonly gatewayDown = false,
    /** This message can never be delivered (the number is not on WhatsApp): do not retry. */
    readonly permanent = false,
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

const headers = (cfg: GatewayConfig) => ({ 'Content-Type': 'application/json', 'X-API-Key': cfg.key });

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown; error?: { message?: unknown } } | null;
  const msg = body?.message ?? body?.error?.message;
  return typeof msg === 'string' ? msg : Array.isArray(msg) ? msg.join('; ') : `HTTP ${res.status}`;
}

/** Send one text message. `idempotencyKey` makes a retry of the same message safe: the gateway sends it once. */
export async function sendText(
  cfg: GatewayConfig,
  chatId: string,
  text: string,
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ messageId: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.url}/api/sessions/${encodeURIComponent(cfg.sessionId)}/messages/send-text`, {
      method: 'POST',
      headers: { ...headers(cfg), 'Idempotency-Key': idempotencyKey.slice(0, 255) },
      body: JSON.stringify({ chatId, text }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new GatewayError(`The WhatsApp gateway could not be reached: ${err instanceof Error ? err.message : err}`, undefined, true);
  }
  if (res.ok) {
    const json = (await res.json().catch(() => null)) as { data?: { messageId?: string }; messageId?: string } | null;
    return { messageId: json?.data?.messageId ?? json?.messageId ?? null };
  }
  const message = await errorText(res);
  if (res.status === 401 || res.status === 403) throw new GatewayError(`The gateway refused the API key (${message}).`, res.status, true);
  if (res.status === 409 || res.status === 503) throw new GatewayError(message, res.status, true);
  if (res.status === 429) throw new GatewayError(`The gateway is rate limiting: ${message}`, res.status, true);
  // A 400 for a number WhatsApp does not know will never succeed, however often it is retried.
  const permanent = res.status === 400 && /not registered|not on whatsapp|invalid (number|chat|phone)/i.test(message);
  throw new GatewayError(message, res.status, false, permanent);
}

export type SessionStatus =
  | 'created' | 'initializing' | 'qr_ready' | 'authenticating' | 'ready' | 'disconnected' | 'action_required' | 'failed';

/** The session's state. `ready` is the only one in which messages can be sent. */
export async function sessionStatus(cfg: GatewayConfig, fetchImpl: FetchLike = fetch): Promise<{ status: SessionStatus | 'unknown'; phone: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.url}/api/sessions/${encodeURIComponent(cfg.sessionId)}`, {
      headers: headers(cfg),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new GatewayError(`The WhatsApp gateway could not be reached: ${err instanceof Error ? err.message : err}`, undefined, true);
  }
  if (!res.ok) throw new GatewayError(await errorText(res), res.status, true);
  const json = (await res.json().catch(() => null)) as { data?: { status?: string; phone?: string | null }; status?: string; phone?: string | null } | null;
  const s = json?.data ?? json;
  return { status: (s?.status as SessionStatus) ?? 'unknown', phone: s?.phone ?? null };
}
