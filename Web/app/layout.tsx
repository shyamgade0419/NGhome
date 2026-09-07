import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: { default: 'NG Home', template: '%s | NG Home' },
  description: 'Powered by NovaGade — Apartment & Community Management',
  // app/manifest.ts already generates /manifest.webmanifest and Next links
  // it automatically — this covers Android/Chrome's "Add to Home Screen".
  // iOS Safari largely ignores that manifest for icon/standalone behavior
  // (long-standing iOS quirk, still true as of current Safari versions) —
  // appleWebApp + the apple-touch-icon below are what actually make "Add
  // to Home Screen" launch full-screen with the real app icon on iOS,
  // the same pattern sites like mycards.hdfc.bank.in use.
  appleWebApp: {
    capable: true,
    title: 'NG Home',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

// Without width/initialScale, mobile browsers render at desktop width and
// require manual zoom. viewportFit: 'cover' + themeColor let the standalone
// "Add to Home Screen" launch draw edge-to-edge and color the status bar
// area to match the brand instead of leaving it default white/black.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0D2147',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
