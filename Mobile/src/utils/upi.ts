/**
 * The link a UPI app understands. No amount (`am`) is set, so the person
 * decides how much to send — the whole point is that it is optional. Every
 * value is URL-encoded: the UPI ID and name come from the server, and an
 * unencoded "&" or "#" in either would silently corrupt the link.
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
