/**
 * What a society chooses about WhatsApp automation, and the rules that keep an unofficial WhatsApp number safe.
 *
 * Stored in the society's additionalConfig (`whatsapp`), so no migration is needed for it.
 */

export interface WhatsappSettings {
  enabled: boolean;
  /** Days of the month (India) on which unpaid flats are reminded. */
  reminderDays: number[];
}

export const DEFAULT_REMINDER_DAYS = [5, 10];
export const MAX_REMINDER_DAYS = 6;

/** Whole days 1–28 (every month has them), once each, in order, at most MAX_REMINDER_DAYS. Anything else is dropped. */
export function cleanReminderDays(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const days = input.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 28);
  return [...new Set(days)].sort((a, b) => a - b).slice(0, MAX_REMINDER_DAYS);
}

/** What is stored, tolerating a missing or malformed value. Off until the admin switches it on. */
export function readWhatsappSettings(additionalConfig: unknown): WhatsappSettings {
  const raw = (additionalConfig as { whatsapp?: { enabled?: unknown; reminderDays?: unknown } } | null | undefined)?.whatsapp;
  const days = cleanReminderDays(raw?.reminderDays);
  return {
    enabled: raw?.enabled === true,
    reminderDays: Array.isArray(raw?.reminderDays) ? days : DEFAULT_REMINDER_DAYS,
  };
}

/**
 * A phone number as WhatsApp wants it: digits with the country code and no plus. A bare 10-digit number is taken as
 * Indian. Anything that cannot be a real mobile number is refused rather than guessed at, so a typo never sends a
 * message to a stranger.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  if (digits.startsWith('91') && digits.length === 12 && !/^[6-9]/.test(digits.slice(2))) return null; // Indian mobiles start 6–9
  return digits;
}

export const chatIdFor = (phone: string): string => `${phone}@c.us`;

/** Messages are only sent in the daytime, India time: nobody wants a maintenance reminder at 2 a.m. */
export const SEND_WINDOW = { startHour: 9, endHour: 20 };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The India calendar day and hour of an instant. */
export function istParts(now: Date): { date: string; day: number; hour: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { date: ist.toISOString().slice(0, 10), day: ist.getUTCDate(), hour: ist.getUTCHours() };
}

export function inSendWindow(now: Date): boolean {
  const { hour } = istParts(now);
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour;
}

/** The start (as an instant) of the India calendar day containing `now`. */
export function istDayStart(now: Date): Date {
  const { date } = istParts(now);
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}
