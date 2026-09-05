import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

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
  const accessToken = cookies().get('ng_access')?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const backendRes = await fetch(`${API_URL}/api/v1/payments/${id}/proof`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!backendRes.ok) {
    // Error responses from this endpoint are JSON — safe to pass through as-is.
    const body = await backendRes.json().catch(() => ({ message: 'Failed to load receipt' }));
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
