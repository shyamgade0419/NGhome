import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export async function POST() {
  const cookieStore = cookies();
  const refreshToken = cookieStore.get('ng_refresh')?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: 'No refresh token' }, { status: 401 });
  }

  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    const response = NextResponse.json({ message: 'Session expired' }, { status: 401 });
    response.cookies.delete('ng_access');
    response.cookies.delete('ng_refresh');
    response.cookies.delete('ng_session');
    return response;
  }

  // Backend wraps all responses: { success: true, data: T }
  const envelope = await res.json();
  const { accessToken, refreshToken: newRefresh } = envelope.data;
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set('ng_access', accessToken, { ...COOKIE_OPTS, maxAge: 60 * 15 });
  response.cookies.set('ng_refresh', newRefresh, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
  response.cookies.set('ng_session', '1', { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
  return response;
}
