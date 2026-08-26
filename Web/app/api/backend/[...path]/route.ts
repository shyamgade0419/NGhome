import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

// Calls the backend refresh endpoint directly — no HTTP self-call.
async function callBackendRefresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
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

async function proxy(req: NextRequest): Promise<NextResponse> {
  const cookieStore = cookies();
  let accessToken = cookieStore.get('ng_access')?.value;
  const storedRefresh = cookieStore.get('ng_refresh')?.value;

  const pathSegments = req.nextUrl.pathname.replace('/api/backend', '');
  const search = req.nextUrl.search;
  const url = `${API_URL}${pathSegments}${search}`;

  // Read body once; reused for both the initial attempt and any retry.
  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

  const doRequest = (token: string | undefined) =>
    fetch(url, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });

  let backendRes = await doRequest(accessToken);
  let rotatedTokens: { accessToken: string; refreshToken: string } | null = null;

  // On 401, attempt one silent token rotation and retry.
  if (backendRes.status === 401 && storedRefresh) {
    rotatedTokens = await callBackendRefresh(storedRefresh);
    if (rotatedTokens) {
      accessToken = rotatedTokens.accessToken;
      backendRes = await doRequest(accessToken);
    }
  }

  // Parse backend response body safely — 204 / empty responses have no JSON.
  const contentType = backendRes.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const isEmpty = backendRes.status === 204 || backendRes.headers.get('content-length') === '0';

  let responseData: unknown;
  if (isEmpty) {
    responseData = {};
  } else if (isJson) {
    responseData = await backendRes.json();
  } else {
    const text = await backendRes.text();
    responseData = { message: text };
  }

  const response = NextResponse.json(responseData, { status: backendRes.status });

  if (rotatedTokens) {
    // Forward rotated cookies to the browser so it never replays the expired token.
    response.cookies.set('ng_access', rotatedTokens.accessToken, {
      ...COOKIE_OPTS,
      maxAge: 60 * 15,
    });
    response.cookies.set('ng_refresh', rotatedTokens.refreshToken, {
      ...COOKIE_OPTS,
      maxAge: 60 * 60 * 24 * 7,
    });
    response.cookies.set('ng_session', '1', {
      ...COOKIE_OPTS,
      maxAge: 60 * 60 * 24 * 7,
    });
  } else if (backendRes.status === 401 && storedRefresh) {
    // Refresh itself failed — clear all session cookies so the client redirects to login.
    response.cookies.delete('ng_access');
    response.cookies.delete('ng_refresh');
    response.cookies.delete('ng_session');
  }

  return response;
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
