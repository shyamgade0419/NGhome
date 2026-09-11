/**
 * Content-Security-Policy, chosen to match what this app actually does —
 * checked against the codebase, not copied from a generic template:
 *   - every API call goes through the same-origin BFF routes under
 *     /api/backend* (Web/app/api/backend/[...path]/route.ts and
 *     /api/backend-file/*) — the browser never calls the NG Home API,
 *     ServerByt, or any other host directly, so connect-src is 'self' only.
 *   - app/globals.css pulls the Inter font from Google Fonts via @import —
 *     the one external host this app actually loads from, so style-src and
 *     font-src need to name it explicitly. No next/image remote loader, no
 *     analytics/embed scripts, no <iframe> anywhere in the app (checked
 *     with rg — and confirmed for real by booting the dev server and
 *     reading the browser console for CSP violations, not just by reading
 *     the source).
 *   - script-src needs 'unsafe-inline': the App Router (no per-request nonce
 *     wired up here) injects its own small inline hydration scripts, which
 *     a nonce-less CSP has no other way to allow. This is the one
 *     unavoidable exception; everything else is as strict as the app allows.
 *   - img-src allows data:/blob: for any client-side file/image preview.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  // Superseded by frame-ancestors above for CSP-aware browsers; kept for
  // the handful that only understand the older header.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No page in this app uses the camera, microphone, geolocation or
  // payment-request APIs (checked with rg) — deny them outright.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Harmless to send over plain HTTP (browsers only act on it over HTTPS);
  // production is HTTPS-only via the reverse proxy either way.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
