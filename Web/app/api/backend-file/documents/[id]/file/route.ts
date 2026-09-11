import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

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
 * does no authorization of its own, it only forwards the caller's cookie
 * as a Bearer token and passes the response straight back.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accessToken = cookies().get('ng_access')?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const backendRes = await fetch(`${API_URL}/api/v1/documents/${id}/file`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!backendRes.ok) {
    // Error responses from this endpoint are JSON — safe to pass through as-is.
    const body = await backendRes.json().catch(() => ({ message: 'Failed to load document' }));
    return NextResponse.json(body, { status: backendRes.status });
  }

  const buffer = await backendRes.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': backendRes.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': backendRes.headers.get('content-disposition') ?? 'inline',
    },
  });
}
