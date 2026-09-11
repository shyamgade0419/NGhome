import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchBackendWithRefresh, applyTokenRotation } from '@/lib/server/backend-request';

/**
 * Streams the actual bytes for an uploaded (SFTP-backed) document straight
 * through — deliberately NOT going through /api/backend/[...path], which
 * always does `NextResponse.json(await res.text())` on the backend
 * response. That's correct for every other route (all JSON), but would
 * corrupt a PDF/image by round-tripping it through .text() and JSON
 * string-wrapping it. Mirrors the payment-proof download route for the
 * same reason.
 *
 * The backend (documentsService.getFileBuffer) already re-checks visibility
 * against the caller's own token before returning anything — this route
 * does no authorization of its own beyond forwarding the caller's session,
 * refreshing it once if the access token has expired.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // A cheap presence check, not a substitute for the backend's own auth —
  // see the same note in backend-file/documents/route.ts.
  if (!cookies().get('ng_access')?.value) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { res: backendRes, rotatedTokens, hadRefreshToken } = await fetchBackendWithRefresh(
    `/documents/${id}/file`,
    { method: 'GET' },
  );

  if (!backendRes.ok) {
    // Error responses from this endpoint are JSON — safe to pass through as-is.
    const body = await backendRes.json().catch(() => ({ message: 'Failed to load document' }));
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
