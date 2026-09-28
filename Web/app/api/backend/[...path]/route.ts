import { NextRequest, NextResponse } from 'next/server';
import { fetchBackendWithRefresh, applyTokenRotation } from '@/lib/server/backend-request';
import { rejectIfTooLarge, JSON_BODY_MAX_BYTES } from '@/lib/server/request-size';

async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathSegments = req.nextUrl.pathname.replace('/api/backend', '');
  const search = req.nextUrl.search;

  // DELETE is treated the same as GET/HEAD: every DELETE call this app's own
  // clients make sends no body (api.delete(url), no data argument — checked
  // across every endpoints.ts caller), so a real browser omits Content-Length
  // on it entirely. rejectIfTooLarge() below fails closed on a missing
  // Content-Length — correct for POST/PUT/PATCH, where a body is expected and
  // its absence could mean a size-hiding chunked upload, but it was rejecting
  // every genuinely bodyless DELETE as "too large" before it ever reached the
  // backend, breaking every delete button in the app (discovered testing the
  // new society-delete feature — not something that feature introduced).
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE';

  // Reject an oversized body by its declared Content-Length before
  // buffering it — req.text() below reads the entire body into memory
  // with no size cap of its own. Every call through this proxy is a small
  // JSON control-plane payload; see lib/server/request-size.ts.
  if (hasBody) {
    const tooLarge = rejectIfTooLarge(req, JSON_BODY_MAX_BYTES);
    if (tooLarge) return tooLarge;
  }

  // Read body once; reused for both the initial attempt and any retry —
  // a plain string is safe to send twice, unlike a body stream.
  const body = hasBody ? await req.text() : undefined;

  const { res: backendRes, rotatedTokens, hadRefreshToken } = await fetchBackendWithRefresh(
    `${pathSegments}${search}`,
    { method: req.method, headers: { 'Content-Type': 'application/json' }, body },
  );

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
  applyTokenRotation(response, rotatedTokens, hadRefreshToken, backendRes.status);
  return response;
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
