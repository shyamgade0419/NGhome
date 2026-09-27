/**
 * The link a UPI app understands. No amount (`am`) is set, so the person
 * decides how much to send — the whole point is that it is optional.
 * Every value is URL-encoded: the UPI ID and name come from the database, and
 * an unencoded "&" or "#" in either would silently corrupt the link.
 */
export function buildUpiUri(upiId: string, payeeName: string, note = 'Support NG Home'): string {
  const params = [
    ['pa', upiId],
    ['pn', payeeName],
    ['tn', note],
    ['cu', 'INR'],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `upi://pay?${params}`;
}

const DISMISS_KEY = 'ng_support_dismissed_until';
const DISMISS_DAYS = 30;

/** localStorage can throw (private mode, blocked storage) — treat that as "not dismissed". */
export function isSupportDismissed(now = Date.now()): boolean {
  try {
    const until = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

export function dismissSupport(now = Date.now()): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(now + DISMISS_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Storage unavailable: the banner simply reappears next visit.
  }
}
