'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (public/sw.js). Production only: in development a worker would keep
 * serving stale build output while the code is being changed.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Not installable without it, but the app works exactly as before.
    });
  }, []);

  return null;
}
