/**
 * Talks to Meta's WhatsApp Business Cloud API (the Graph API): the official way to send WhatsApp messages. Each society
 * brings its own Meta business account, so every call here is made with that society's own phone number id and access
 * token, and pays Meta directly for its messages.
 *
 *   WHATSAPP_CLOUD_API_BASE     default https://graph.facebook.com   (tests point it at a local fake)
 *   WHATSAPP_CLOUD_API_VERSION  default v21.0
 *
 * Errors become GatewayError, the same type the OpenWA client throws, so the sender treats both alike:
 *   gatewayDown + societyOnly  this society's connection cannot send right now (token refused, template not approved,
 *                              rate limited, account problem): hold its messages, let the others go.
 *   permanent                  this message can never be delivered (not on WhatsApp, not allowed to receive): do not retry.
 *   neither                    a one-off failure: retry later.
 */

import { GatewayError } from './openwa.client';
import { CLOUD_LANGUAGE, CloudTemplate } from './whatsapp-cloud-templates';

export interface CloudCreds {
  phoneNumberId: string;
  accessToken: string;
  /** The WhatsApp Business Account id; only needed to create and list templates. */
  wabaId?: string | null;
}

type FetchLike = typeof fetch;

const base = () => (process.env.WHATSAPP_CLOUD_API_BASE?.trim() || 'https://graph.facebook.com').replace(/\/+$/, '');
const version = () => process.env.WHATSAPP_CLOUD_API_VERSION?.trim() || 'v21.0';
const url = (path: string) => `${base()}/${version()}/${path}`;
const headers = (c: CloudCreds) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${c.accessToken}` });

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; error_user_title?: string; error_user_msg?: string; error_data?: { details?: string } };
}

/** What Meta said went wrong, in its own plainest words. */
function metaText(body: GraphError | null, status: number): string {
  const e = body?.error;
  return e?.error_user_msg || e?.error_data?.details || e?.message || `HTTP ${status}`;
}

/** Meta's error → how the sender should treat it. See the header for the three outcomes. */
export function cloudError(status: number, body: GraphError | null): GatewayError {
  const code = body?.error?.code;
  const text = metaText(body, status);
  const down = (message: string) => new GatewayError(message, status, true, false, true);

  // The token is wrong, expired or has lost its permission.
  if (status === 401 || code === 190 || code === 102 || code === 10 || (code !== undefined && code >= 200 && code <= 299)) {
    return down(`Meta refused the access token (${text}). Create a new token in Meta Business Suite and connect again.`);
  }
  // Slowed down by Meta, or the account is limited: hold the society's messages until it passes.
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80007 || code === 130429 || code === 131048 || status === 429) {
    return down(`Meta is limiting this account's messages for now (${text}). They will go out later.`);
  }
  if (code === 131042 || code === 131031 || code === 131005 || code === 133010 || code === 133016) {
    return down(`Meta cannot send from this WhatsApp Business account (${text}). Check it in WhatsApp Manager.`);
  }
  // The template is missing, not approved yet, or does not match what was approved.
  if (code === 132001 || code === 132000 || code === 132005 || code === 132007 || code === 132012 || code === 132015 || code === 132016) {
    return down(`The message template is not ready on this WhatsApp Business account (${text}). Check that the message templates are approved.`);
  }
  // This person cannot receive it: not on WhatsApp, or the account is still in test mode and the number is not on its list.
  if (code === 131026 || code === 131030 || code === 131021 || code === 131009 || code === 131049 || code === 130472) {
    return new GatewayError(text, status, false, true);
  }
  return new GatewayError(text, status, false, false);
}

async function call<T>(c: CloudCreds, method: 'GET' | 'POST', path: string, body?: unknown, fetchImpl: FetchLike = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url(path), {
      method,
      headers: headers(c),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new GatewayError(`Meta's WhatsApp service could not be reached: ${err instanceof Error ? err.message : err}`, undefined, true, false, true);
  }
  const json = (await res.json().catch(() => null)) as (T & GraphError) | null;
  if (!res.ok) throw cloudError(res.status, json);
  return json as T;
}

/** The business phone number's display number and verified name: proves the id and the token belong together. */
export async function getPhoneNumber(c: CloudCreds, fetchImpl: FetchLike = fetch): Promise<{ displayPhone: string | null; verifiedName: string | null }> {
  const r = await call<{ display_phone_number?: string; verified_name?: string }>(c, 'GET', `${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`, undefined, fetchImpl);
  const digits = (r.display_phone_number ?? '').replace(/\D/g, '');
  return { displayPhone: digits || null, verifiedName: r.verified_name ?? null };
}

/** Send an approved template, filling its blanks. `to` is digits with the country code, no plus. */
export async function sendTemplate(
  c: CloudCreds,
  to: string,
  template: { name: string; language: string },
  params: string[],
  fetchImpl: FetchLike = fetch,
): Promise<{ messageId: string | null }> {
  const r = await call<{ messages?: { id?: string }[] }>(
    c,
    'POST',
    `${encodeURIComponent(c.phoneNumberId)}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
      },
    },
    fetchImpl,
  );
  return { messageId: r.messages?.[0]?.id ?? null };
}

export interface CloudTemplateStatus {
  name: string;
  /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED | IN_APPEAL ... as Meta reports it. */
  status: string;
  rejectedReason: string | null;
}

/** The business account's templates in NG Home's language, with Meta's verdict on each. */
export async function listTemplates(c: CloudCreds, fetchImpl: FetchLike = fetch): Promise<CloudTemplateStatus[]> {
  if (!c.wabaId) return [];
  const r = await call<{ data?: { name: string; status: string; language?: string; rejected_reason?: string }[] }>(
    c,
    'GET',
    `${encodeURIComponent(c.wabaId)}/message_templates?fields=name,status,language,rejected_reason&limit=200`,
    undefined,
    fetchImpl,
  );
  return (r.data ?? [])
    .filter((t) => t.language === CLOUD_LANGUAGE || t.language === undefined)
    .map((t) => ({ name: t.name, status: t.status, rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null }));
}

/** Submit one template for Meta's approval. */
export async function createTemplate(c: CloudCreds, t: CloudTemplate, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!c.wabaId) throw new GatewayError('Enter the WhatsApp Business Account ID first.', 400);
  await call(
    c,
    'POST',
    `${encodeURIComponent(c.wabaId)}/message_templates`,
    {
      name: t.name,
      language: CLOUD_LANGUAGE,
      category: 'UTILITY',
      components: [{ type: 'BODY', text: t.text, example: { body_text: [t.samples] } }],
    },
    fetchImpl,
  );
}
