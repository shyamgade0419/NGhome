import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export async function POST() {
  const cookieStore = cookies();
  const accessToken = cookieStore.get('ng_access')?.value;
  const refreshToken = cookieStore.get('ng_refresh')?.value;

  if (accessToken && refreshToken) {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete('ng_access');
  response.cookies.delete('ng_refresh');
  response.cookies.delete('ng_session');
  return response;
}
