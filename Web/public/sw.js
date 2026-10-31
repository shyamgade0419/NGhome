/*
 * NG Home service worker.
 *
 * It does two things and nothing more:
 *   1. Makes the app installable (Chrome / Edge / Android want a fetch handler).
 *   2. Shows a plain "you are offline" page instead of the browser's error page when a page
 *      cannot be reached.
 *
 * It deliberately does NOT cache pages or API responses. Bills, payments and resident details are
 * private and change all the time; a stale copy that looks current is worse than an honest
 * "you are offline". Only the app's own static files (hashed build output and icons) are kept.
 *
 * Bump VERSION to drop everything cached by an older worker.
 */
const VERSION = 'v1';
const CACHE = `ng-static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
const MAX_STATIC_ENTRIES = 150;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keep the static cache from growing without end across deploys: drop the oldest entries. */
async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Anything that carries data goes straight to the network, untouched.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Build output is content-hashed, so a cached copy can never be out of date.
  if (url.pathname.startsWith('/_next/static/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
