import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/join', '/select-society', '/forgot-password', '/reset-password'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    const session = request.cookies.get('ng_session');
    if (session) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const session = request.cookies.get('ng_session');
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // manifest.webmanifest (app/manifest.ts) and the PWA icon files
  // (public/*.png) weren't excluded — an unauthenticated request for any
  // of them (exactly what iOS/Android do when reading the manifest for
  // "Add to Home Screen", or a browser's own favicon fetch, neither of
  // which carries the ng_session cookie a page navigation would) got
  // redirected to /login same as any other page, breaking the PWA
  // metadata for anyone who hadn't already logged in with a live session.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|favicon-32.png|icon-192.png|icon-512.png|apple-touch-icon.png|manifest.webmanifest).*)',
  ],
};
