/**
 * India-time formatting for amenity booking, done by hand rather than through
 * Intl's timeZone option: Hermes' Intl support differs between Android
 * versions, and a slot label that silently renders in the phone's own zone
 * would show a resident the wrong hour. IST has a fixed +05:30 offset and no
 * daylight saving, so adding it and reading the UTC fields is exact.
 */

const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ist(input: string | Date): Date {
  return new Date(new Date(input).getTime() + IST_OFFSET_MS);
}

/** The IST calendar date of an instant, "YYYY-MM-DD". */
export function istDateString(input: string | Date): string {
  return ist(input).toISOString().slice(0, 10);
}

/** "2026-11-04" plus n days, as a date string — pure calendar arithmetic, no zone involved. */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "6:00 PM" */
export function fmtTime(input: string | Date): string {
  const d = ist(input);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Wed, 4 Nov" for a "YYYY-MM-DD" date. */
export function fmtDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]}, ${d} ${MONTHS[m - 1]}`;
}

/** "Wed, 4 Nov" for an instant, in India time. */
export function fmtDayOf(input: string | Date): string {
  return fmtDay(istDateString(input));
}

/** "Wed, 4 Nov · 6:00 PM – 7:00 PM" */
export function fmtRange(startAt: string | Date, endAt: string | Date): string {
  return `${fmtDayOf(startAt)} · ${fmtTime(startAt)} – ${fmtTime(endAt)}`;
}

/** 360 -> "06:00" */
export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** "06:00" / "6:00" / "18:30" -> minutes since midnight, or null if it isn't a time. "24:00" is allowed (end of day). */
export function parseHHMM(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/** 360 -> "6:00 AM", 1320 -> "10:00 PM", 1440 -> "12:00 AM" (opening-hours display). */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
