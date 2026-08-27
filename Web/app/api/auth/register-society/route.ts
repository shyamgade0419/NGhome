import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export async function POST(req: NextRequest) {
  const body = await req.json();

  const res = await fetch(`${API_URL}/auth/register-society`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const envelope = await res.json();

  if (!res.ok) {
    return NextResponse.json(envelope, { status: res.status });
  }

  const { accessToken, refreshToken, user, memberships } = envelope.data;

  const response = NextResponse.json({ user, memberships }, { status: 201 });
  response.cookies.set('ng_access', accessToken, { ...COOKIE_OPTS, maxAge: 60 * 15 });
  response.cookies.set('ng_refresh', refreshToken, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
  response.cookies.set('ng_session', '1', { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });

  return response;
}
