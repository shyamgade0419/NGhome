/**
 * Helpers for the "install NG Home" prompt. Everything that touches the browser is wrapped, because
 * localStorage, matchMedia and navigator can be missing or throw (private windows, old browsers,
 * server render).
 */

const DISMISS_KEY = 'ng_install_dismissed_until';
const DISMISS_DAYS = 30;

/** True when the app is already running as an installed app, not in a browser tab. */
export function isStandalone(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    // iOS Safari sets this instead of the media query when launched from the home screen.
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** iPhone, iPad and iPod. iPadOS 13+ reports itself as a Mac, so a touch screen gives it away. */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function isInstallDismissed(now = Date.now()): boolean {
  try {
    const until = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

export function dismissInstall(now = Date.now()): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(now + DISMISS_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Storage unavailable: the prompt simply comes back next visit.
  }
}
