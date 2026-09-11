import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchBackendWithRefresh, applyTokenRotation } from '@/lib/server/backend-request';

/**
 * Forwards a multipart payment submission (fields + an optional receipt
 * file) straight through — same reason this can't go through the generic
 * /api/backend/[...path] proxy as the payment-proof download route: that
 * one always reads the body as text and sets Content-Type: application/
 * json on the outgoing request, which would mangle a file's binary bytes
 * and drop the multipart boundary the backend needs to parse it. Reading
 * the incoming request as FormData and handing that same FormData
 * straight to fetch() lets fetch re-encode it with a fresh, correct
 * multipart boundary — no manual parsing needed, and it's what makes the
 * same FormData instance safe to reuse for the refresh-and-retry below.
 *
 * A retry here is one browser-initiated submission being replayed once at
 * the auth layer after a token rotation — not a second user action — so it
 * carries no duplicate-payment risk beyond what the backend's own UTR
 * idempotency check already handles for a genuine double-tap.
 */
export async function POST(req: NextRequest) {
  if (!cookies().get('ng_access')?.value) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const incoming = await req.formData();

  const { res: backendRes, rotatedTokens, hadRefreshToken } = await fetchBackendWithRefresh(
    '/payments',
    { method: 'POST', body: incoming },
  );

  const data = await backendRes.json().catch(() => ({}));
  const response = NextResponse.json(data, { status: backendRes.status });
  applyTokenRotation(response, rotatedTokens, hadRefreshToken, backendRes.status);
  return response;
}
