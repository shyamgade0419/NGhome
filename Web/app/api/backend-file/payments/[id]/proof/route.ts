import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchBackendWithRefresh, applyTokenRotation } from '@/lib/server/backend-request';

/**
 * Streams the actual receipt/screenshot bytes for a payment straight
 * through — deliberately NOT going through /api/backend/[...path], which
 * always does `NextResponse.json(await res.text())` on the backend
 * response. That's correct for every other route (all JSON), but would
 * corrupt an image/PDF by round-tripping it through .text() and JSON
 * string-wrapping it. This route exists only because that one can't
 * safely be made to handle binary bodies without risking every other
 * call through it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!cookies().get('ng_access')?.value) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { res: backendRes, rotatedTokens, hadRefreshToken } = await fetchBackendWithRefresh(
    `/payments/${id}/proof`,
    { method: 'GET' },
  );

  if (!backendRes.ok) {
    // Error responses from this endpoint are JSON — safe to pass through as-is.
    const body = await backendRes.json().catch(() => ({ message: 'Failed to load receipt' }));
    const response = NextResponse.json(body, { status: backendRes.status });
    applyTokenRotation(response, rotatedTokens, hadRefreshToken, backendRes.status);
    return response;
  }

  const buffer = await backendRes.arrayBuffer();
  const response = new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': backendRes.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': backendRes.headers.get('content-disposition') ?? 'inline',
    },
  });
  applyTokenRotation(response, rotatedTokens, hadRefreshToken, backendRes.status);
  return response;
}
