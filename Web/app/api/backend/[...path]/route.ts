import { NextRequest, NextResponse } from 'next/server';
import { fetchBackendWithRefresh, applyTokenRotation } from '@/lib/server/backend-request';

async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathSegments = req.nextUrl.pathname.replace('/api/backend', '');
  const search = req.nextUrl.search;

  // Read body once; reused for both the initial attempt and any retry —
  // a plain string is safe to send twice, unlike a body stream.
  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

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
