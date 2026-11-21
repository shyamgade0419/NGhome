import { istParts } from '../whatsapp/whatsapp-settings';

/** The reminder goes out from this hour, India time, on its day: not in the middle of the night. */
export const REMIND_FROM_HOUR = 9;
/** A reminder missed on its day (the server was down) is still sent for this many days after, then skipped until next month. */
export const GRACE_DAYS = 2;
export const DEFAULT_REMINDER_DAY = 8;

/** 'YYYY-MM' of the India calendar month containing `now`. */
export const monthKey = (now: Date): string => istParts(now).date.slice(0, 7);

/** The consumer number as it is stored: trimmed, single spaces, capitals, so the same number cannot be saved twice by typing it differently. */
export const cleanConsumerNumber = (raw: string): string => raw.trim().replace(/\s+/g, ' ').toUpperCase();

/** Only the last four characters, for a lock screen: "•••• 4521". */
export function maskNumber(n: string): string {
  const t = n.replace(/\s+/g, '');
  return t.length > 4 ? `•••• ${t.slice(-4)}` : t;
}

/**
 * Whether the reminder should go out at this moment: it is its day (or up to GRACE_DAYS after), the morning has come, and it has not
 * already gone this month. Running it any number of times in that window sends it once.
 */
export function reminderDue(now: Date, reminderDay: number, lastRemindedMonth: string | null): boolean {
  const { day, hour } = istParts(now);
  if (hour < REMIND_FROM_HOUR) return false;
  if (lastRemindedMonth === monthKey(now)) return false;
  return day >= reminderDay && day - reminderDay <= GRACE_DAYS;
}

/** The date of the next reminder ("YYYY-MM-DD", India calendar), for showing "Next reminder: 8 Dec". */
export function nextReminderDate(now: Date, reminderDay: number, lastRemindedMonth: string | null): string {
  const { date, day } = istParts(now);
  const [y, m] = date.split('-').map(Number);
  const thisMonth = monthKey(now);
  // Still to come this month, or due right now and not yet sent.
  const pending = lastRemindedMonth !== thisMonth && day <= reminderDay + GRACE_DAYS;
  const [yy, mm] = pending ? [y, m] : m === 12 ? [y + 1, 1] : [y, m + 1];
  return `${yy}-${String(mm).padStart(2, '0')}-${String(reminderDay).padStart(2, '0')}`;
}
