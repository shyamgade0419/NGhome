/**
 * Slot arithmetic for amenity booking, all in India Standard Time.
 *
 * The product is India-only and IST (UTC+05:30) has no daylight saving, so a
 * fixed offset is exact — there is no ambiguous or missing local hour to
 * get wrong. Instants are stored as UTC (Postgres timestamps); everything a
 * person thinks in ("the 6 pm slot on the 14th") is converted here, in one
 * place, rather than scattered through the service.
 *
 * Pure functions, no I/O, so the rules that decide whether a booking is
 * valid can be tested exhaustively without a database.
 */

export const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * MS_PER_MINUTE;
const MINUTES_PER_DAY = 1440;

export interface SlotRules {
  slotMinutes: number;
  opensAtMin: number;
  closesAtMin: number;
}

export interface Slot {
  startAt: Date;
  endAt: Date;
}

/** "2026-11-04" -> the UTC instant of 00:00 IST that day, or null if it isn't a real date. */
export function istDayStartUtc(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utcMidnight = Date.UTC(y, m - 1, d);
  const check = new Date(utcMidnight);
  // Date.UTC rolls 2026-02-31 over to March; reject rather than silently shift the day.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return new Date(utcMidnight - IST_OFFSET_MS);
}

/** Minutes since midnight IST for an instant (0–1439). */
export function istMinutesOfDay(instant: Date): number {
  const shifted = instant.getTime() + IST_OFFSET_MS;
  return Math.floor((((shifted / MS_PER_MINUTE) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
}

/** The IST calendar date of an instant, as "YYYY-MM-DD". */
export function istDateString(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) of the IST calendar month containing the instant, as UTC instants. */
export function istMonthRangeUtc(instant: Date): { start: Date; end: Date } {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET_MS),
  };
}

/** Every bookable slot on one IST date, in order. A slot that would run past closing time is not offered. */
export function generateSlots(rules: SlotRules, dateStr: string): Slot[] {
  const dayStart = istDayStartUtc(dateStr);
  if (!dayStart || rules.slotMinutes <= 0) return [];
  const slots: Slot[] = [];
  for (let start = rules.opensAtMin; start + rules.slotMinutes <= rules.closesAtMin; start += rules.slotMinutes) {
    slots.push({
      startAt: new Date(dayStart.getTime() + start * MS_PER_MINUTE),
      endAt: new Date(dayStart.getTime() + (start + rules.slotMinutes) * MS_PER_MINUTE),
    });
  }
  return slots;
}

export type WindowCheck = { ok: true; endAt: Date } | { ok: false; reason: string };

/**
 * Does a booking of `slotCount` consecutive slots starting at `startAt` land
 * exactly on the amenity's slot grid and inside its opening hours?
 */
export function checkBookingWindow(rules: SlotRules, startAt: Date, slotCount: number): WindowCheck {
  if (!Number.isInteger(slotCount) || slotCount < 1) return { ok: false, reason: 'Choose at least one slot.' };

  const startMin = istMinutesOfDay(startAt);
  // A start time with seconds or milliseconds can never be a slot boundary.
  if (startAt.getTime() % MS_PER_MINUTE !== 0) return { ok: false, reason: 'That is not a valid slot start.' };
  if (startMin < rules.opensAtMin || (startMin - rules.opensAtMin) % rules.slotMinutes !== 0) {
    return { ok: false, reason: 'That is not a valid slot start.' };
  }

  const endMin = startMin + slotCount * rules.slotMinutes;
  if (endMin > rules.closesAtMin) return { ok: false, reason: 'That booking runs past closing time.' };

  return { ok: true, endAt: new Date(startAt.getTime() + slotCount * rules.slotMinutes * MS_PER_MINUTE) };
}
