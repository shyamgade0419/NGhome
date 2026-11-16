'use client';

import { useSyncExternalStore } from 'react';

/**
 * The look of the web app. `glass` is the default: frosted surfaces over a soft aurora. `classic` is the flat warm-beige look the
 * app had before, kept for anyone who prefers it. The choice is kept in this browser and applied to <html data-look="…"> before the
 * page paints (LOOK_BOOT_SCRIPT, run from the root layout), so there is no flash of the wrong look. Every glass rule lives under
 * html[data-look='glass'] (app/glass.css); with `classic` none of them apply and the app is exactly what it was.
 */
export type Look = 'glass' | 'classic';

export const LOOK_KEY = 'nghome-look';
export const DEFAULT_LOOK: Look = 'glass';
const CHANGED = 'nghome-look-change';

const clean = (v: unknown): Look => (v === 'classic' || v === 'glass' ? v : DEFAULT_LOOK);

/** Inline script for <head>: sets the look before first paint. Blocked storage means the default. */
export const LOOK_BOOT_SCRIPT = `try{var l=localStorage.getItem('${LOOK_KEY}');document.documentElement.dataset.look=l==='classic'?'classic':'glass'}catch(e){document.documentElement.dataset.look='glass'}`;

export function readLook(): Look {
  try {
    return clean(localStorage.getItem(LOOK_KEY));
  } catch {
    return DEFAULT_LOOK;
  }
}

export function setLook(look: Look): void {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    /* blocked storage: the look still changes for this visit */
  }
  document.documentElement.dataset.look = look;
  window.dispatchEvent(new Event(CHANGED));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGED, cb);
  window.addEventListener('storage', cb); // another tab changed it
  return () => {
    window.removeEventListener(CHANGED, cb);
    window.removeEventListener('storage', cb);
  };
};

/** The look in effect, re-rendering when it changes (here or in another tab). */
export function useLook(): Look {
  return useSyncExternalStore(subscribe, readLook, () => DEFAULT_LOOK);
}
