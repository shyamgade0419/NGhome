import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NG Home — Society Management',
    short_name: 'NG Home',
    description: 'Manage maintenance billing, water readings, and residents for your gated community.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    // Matches the actual brand navy used everywhere else (login screen,
    // app icon, mobile splash screen) — this file previously had a
    // generic blue with no relationship to the brand, same class of
    // mismatch the mobile app's colors.ts once had before it was fixed.
    theme_color: '#0D2147',
    orientation: 'portrait-primary',
    categories: ['utilities', 'productivity'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
