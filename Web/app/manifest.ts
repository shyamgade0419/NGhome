import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity: if start_url ever changes, installed copies stay the same app.
    id: '/',
    name: 'NG Home — Society Management',
    short_name: 'NG Home',
    description: 'Manage maintenance billing, water readings, and residents for your gated community.',
    lang: 'en-IN',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // The brand navy the icon sits on, so the launch splash and the icon are one colour.
    background_color: '#0D2147',
    theme_color: '#0D2147',
    // Not locked to portrait: the billing tables and the maintenance sheet need the width on a
    // laptop, and phones may rotate for them too.
    orientation: 'any',
    categories: ['utilities', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Full-bleed with the logo inside the central safe zone, for Android's circular and squircle masks.
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press the icon (Android) or right-click it (desktop) for these.
    shortcuts: [
      { name: 'My bills', short_name: 'Bills', url: '/billing/my', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Notifications', short_name: 'Alerts', url: '/notifications', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
