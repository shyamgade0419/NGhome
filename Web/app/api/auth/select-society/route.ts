import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const accessToken = cookieStore.get('ng_access')?.value;
  const body = await req.json();

  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const res = await fetch(`${API_URL}/api/v1/auth/select-society`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const envelope = await res.json();
  if (!res.ok) return NextResponse.json(envelope, { status: res.status });

  // Backend wraps all responses: { success: true, data: T }
  const { accessToken: newAccess, refreshToken: newRefresh, user, memberships } = envelope.data;
  const response = NextResponse.json({ user, memberships }, { status: 200 });
  response.cookies.set('ng_access', newAccess, { ...COOKIE_OPTS, maxAge: 60 * 15 });
  response.cookies.set('ng_refresh', newRefresh, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
  response.cookies.set('ng_session', '1', { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
  return response;
}
