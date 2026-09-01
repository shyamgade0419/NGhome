import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/** Public — returns society name + flat list for a given invite code. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ message: 'code is required' }, { status: 400 });

  const res = await fetch(`${API_URL}/api/v1/societies/by-code/${encodeURIComponent(code)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
