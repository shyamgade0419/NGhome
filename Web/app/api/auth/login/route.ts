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

  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const envelope = await res.json();

  if (!res.ok) {
    return NextResponse.json(envelope, { status: res.status });
  }

  // Backend wraps all responses: { success: true, data: T }
  const { accessToken, refreshToken, user, requiresSocietySelection, memberships, activeMembership } = envelope.data;

  // Multi-society: store temporary tokens and return the membership list.
  // The client will POST to /api/auth/select-society with the chosen membershipId.
  if (requiresSocietySelection) {
    const response = NextResponse.json(
      { requiresSocietySelection: true, user, memberships },
      { status: 200 },
    );
    // Store the pre-selection tokens so select-society can send them to the backend.
    response.cookies.set('ng_access', accessToken, { ...COOKIE_OPTS, maxAge: 60 * 15 });
    response.cookies.set('ng_refresh', refreshToken, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
    return response;
  }

  // Single society — set full session cookies immediately.
  const response = NextResponse.json({ user, memberships, activeMembership }, { status: 200 });
  response.cookies.set('ng_access', accessToken, { ...COOKIE_OPTS, maxAge: 60 * 15 });
  response.cookies.set('ng_refresh', refreshToken, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
  response.cookies.set('ng_session', '1', { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });

  return response;
}
