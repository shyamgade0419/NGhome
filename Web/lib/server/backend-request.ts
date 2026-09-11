import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

const ACCESS_TOKEN_MAX_AGE = 60 * 15;
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 7;

type RotatedTokens = { accessToken: string; refreshToken: string };

// Calls the backend refresh endpoint directly — no HTTP self-call.
async function callBackendRefresh(refreshToken: string): Promise<RotatedTokens | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return null;
  const envelope = await res.json();
  const { accessToken, refreshToken: newRefresh } = envelope.data ?? {};
  if (!accessToken || !newRefresh) return null;
  return { accessToken, refreshToken: newRefresh };
}

/**
 * The one place every BFF route handler — JSON, multipart upload, binary
 * download alike — gets an authenticated request to the NG Home API from.
 * Before this, only the generic /api/backend/[...path] proxy silently
 * rotated an expired access token and retried; the dedicated
 * /api/backend-file/* routes (multipart upload, binary download) just
 * returned whatever 401 the backend gave, so an upload or a document/
 * payment-proof download failed outright the moment the 15-minute access
 * token expired, even though the browser was still holding a perfectly
 * good refresh token. Centralising this means every route gets the same
 * lifecycle instead of each one having its own (or none).
 *
 * `init.body` must be safe to send twice — a string, a Buffer/ArrayBuffer,
 * or a FormData (FormData is a structured value, not a stream; fetch()
 * re-encodes it with a fresh boundary each time it's used, so passing the
 * same instance to a retry is safe) — never an already-consumed body
 * stream. GET/HEAD callers simply omit it.
 *
 * Never rotates when there was no access token to begin with — that's an
 * unauthenticated caller, not an expired session, and refresh has nothing
 * to rotate from either.
 */
export async function fetchBackendWithRefresh(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: BodyInit },
): Promise<{ res: Response; rotatedTokens: RotatedTokens | null; hadRefreshToken: boolean }> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get('ng_access')?.value;
  const storedRefresh = cookieStore.get('ng_refresh')?.value;

  const doRequest = (token: string | undefined) =>
    fetch(`${API_URL}/api/v1${path}`, {
      method: init.method,
      headers: {
        ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body,
    });

  let res = await doRequest(accessToken);
  let rotatedTokens: RotatedTokens | null = null;

  // On 401, attempt one silent token rotation and retry.
  if (res.status === 401 && storedRefresh) {
    rotatedTokens = await callBackendRefresh(storedRefresh);
    if (rotatedTokens) {
      res = await doRequest(rotatedTokens.accessToken);
    }
  }

  return { res, rotatedTokens, hadRefreshToken: !!storedRefresh };
}

/**
 * Forwards rotated tokens to the browser as fresh cookies so it never
 * replays the expired one, or — if rotation was attempted and failed —
 * clears the session so the client redirects to login instead of looping
 * on a refresh token that will never work. No-op when neither happened
 * (the common case: the access token was still valid, nothing to rotate).
 */
export function applyTokenRotation(
  response: NextResponse,
  rotatedTokens: RotatedTokens | null,
  hadRefreshToken: boolean,
  finalStatus: number,
): void {
  if (rotatedTokens) {
    response.cookies.set('ng_access', rotatedTokens.accessToken, {
      ...SESSION_COOKIE_OPTS,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    });
    response.cookies.set('ng_refresh', rotatedTokens.refreshToken, {
      ...SESSION_COOKIE_OPTS,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
    response.cookies.set('ng_session', '1', {
      ...SESSION_COOKIE_OPTS,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
  } else if (finalStatus === 401 && hadRefreshToken) {
    response.cookies.delete('ng_access');
    response.cookies.delete('ng_refresh');
    response.cookies.delete('ng_session');
  }
}
