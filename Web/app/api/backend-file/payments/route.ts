import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Forwards a multipart payment submission (fields + an optional receipt
 * file) straight through — same reason this can't go through the generic
 * /api/backend/[...path] proxy as the payment-proof download route: that
 * one always reads the body as text and sets Content-Type: application/
 * json on the outgoing request, which would mangle a file's binary bytes
 * and drop the multipart boundary the backend needs to parse it. Reading
 * the incoming request as FormData and handing that same FormData
 * straight to fetch() lets fetch re-encode it with a fresh, correct
 * multipart boundary — no manual parsing needed.
 */
export async function POST(req: NextRequest) {
  const accessToken = cookies().get('ng_access')?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const incoming = await req.formData();

  const backendRes = await fetch(`${API_URL}/api/v1/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: incoming,
  });

  const data = await backendRes.json().catch(() => ({}));
  return NextResponse.json(data, { status: backendRes.status });
}
