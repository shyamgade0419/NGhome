import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchBackendWithRefresh, applyTokenRotation } from '@/lib/server/backend-request';

/**
 * Forwards a multipart document upload (fields + the actual file) straight
 * through — same reason the payment-proof upload route can't go through the
 * generic /api/backend/[...path] proxy: that one always reads the body as
 * text and sets Content-Type: application/json on the outgoing request,
 * which would mangle a file's binary bytes and drop the multipart boundary
 * the backend needs to parse it. Reading the incoming request as FormData
 * and handing that same FormData straight to fetch() lets fetch re-encode
 * it with a fresh, correct multipart boundary — no manual parsing needed,
 * and it's what makes the same FormData instance safe to reuse for the
 * refresh-and-retry below (it's a structured value, not a consumed stream).
 */
export async function POST(req: NextRequest) {
  // A cheap presence check before buffering a potentially-10MB multipart
  // body — not a substitute for the backend's own auth, just avoids doing
  // that work for a request with no session cookie at all. An access token
  // that exists but has expired still reaches fetchBackendWithRefresh below,
  // which is what actually rotates it.
  if (!cookies().get('ng_access')?.value) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const incoming = await req.formData();

  const { res: backendRes, rotatedTokens, hadRefreshToken } = await fetchBackendWithRefresh(
    '/documents/upload',
    { method: 'POST', body: incoming },
  );

  const data = await backendRes.json().catch(() => ({}));
  const response = NextResponse.json(data, { status: backendRes.status });
  applyTokenRotation(response, rotatedTokens, hadRefreshToken, backendRes.status);
  return response;
}
