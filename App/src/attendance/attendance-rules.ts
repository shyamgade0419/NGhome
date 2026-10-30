import { AttendanceStatus } from '@prisma/client';

/** Everything here is in India time, the society's clock; dates are "YYYY-MM-DD" strings. */

export const ATTENDANCE_LIMITS = {
  /** A mark or roster edit may reach back this many days (corrections, not rewriting a year). */
  backDays: 62,
  /** The longest range a roster request may cover. */
  rangeDays: 62,
  /** Employee-days one roster request may touch (employees x days). */
  rosterCells: 500,
  /** Entries in one "mark the day" request. */
  dayEntries: 200,
  /** Minutes after a shift starts before a check-in counts as late. */
  lateGraceMinutes: 15,
} as const;

const DAY_MS = 86_400_000;

/** A real calendar date in "YYYY-MM-DD" form, as a UTC-midnight Date (what a Postgres DATE column holds); null otherwise. */
export function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (dateStr: string, n: number): string => dateKey(new Date(parseDate(dateStr)!.getTime() + n * DAY_MS));

/** 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (dateStr: string): number => parseDate(dateStr)!.getUTCDay();

/** Every date from..to inclusive, or null when the range is backwards, not real dates, or longer than the limit. */
export function dateRange(from: string, to: string, max: number = ATTENDANCE_LIMITS.rangeDays): string[] | null {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b || b < a) return null;
  const count = Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1;
  if (count > max) return null;
  return Array.from({ length: count }, (_, i) => dateKey(new Date(a.getTime() + i * DAY_MS)));
}

/** All the dates of a "YYYY-MM" month, or null if it is not one. */
export function monthDates(month: string): string[] | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const first = `${month}-01`;
  const next = parseDate(first)!;
  const last = dateKey(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)));
  return dateRange(first, last, 31);
}

/** "06:30" -> 390; null when it is not a time of day. */
export function parseTime(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const formatTime = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Whether a date is one a mark or roster edit may touch: not after today, and not further back than the limit. */
export function dateAllowed(date: string, today: string, { future = false }: { future?: boolean } = {}): { ok: true } | { ok: false; reason: string } {
  if (!parseDate(date)) return { ok: false, reason: 'That is not a valid date.' };
  if (!future && date > today) return { ok: false, reason: 'That date has not happened yet.' };
  if (date < addDays(today, -ATTENDANCE_LIMITS.backDays)) return { ok: false, reason: `Dates more than ${ATTENDANCE_LIMITS.backDays} days back cannot be changed.` };
  return { ok: true };
}

/**
 * Is a check-in late for its shift? Minutes are measured from the shift's start, wrapping at
 * midnight, so a night shift that starts at 22:00 is judged correctly for a 22:20 check-in. Arriving
 * more than 12 hours before the start is early, never late.
 */
export function isLate(shiftStartMinute: number, checkInMinuteOfDay: number, grace: number = ATTENDANCE_LIMITS.lateGraceMinutes): boolean {
  const after = (checkInMinuteOfDay - shiftStartMinute + 1440) % 1440;
  return after > grace && after <= 720;
}

/** Minutes between check-in and check-out; null when either is missing. */
export const workedMinutes = (inAt: Date | null, outAt: Date | null): number | null =>
  inAt && outAt && outAt >= inAt ? Math.round((outAt.getTime() - inAt.getTime()) / 60_000) : null;

export interface SummaryInput {
  /** The dates to count, in order, already cut off at today. */
  dates: string[];
  /** The employee's first and last day of service, as dates, when known. */
  joinDate?: string | null;
  exitDate?: string | null;
  attendance: Map<string, { status: AttendanceStatus; checkInMinuteOfDay: number | null; worked: number | null }>;
  /** The roster for these dates: a shift start for a working day, null for a scheduled day off. */
  roster: Map<string, { shiftStartMinute: number | null }>;
}

export interface Summary {
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  /** Scheduled days off with no attendance row. */
  scheduledOff: number;
  /** Days that count (in service, not a scheduled day off) with no attendance row yet. */
  unmarked: number;
  late: number;
  /** Present days plus half a day for each half day. Information for the person doing salaries; it changes no salary. */
  daysWorked: number;
  workedMinutes: number;
}

/** One employee's month: what was marked, what is still blank, and what was a planned day off. */
export function summarize(input: SummaryInput): Summary {
  const out: Summary = { present: 0, halfDay: 0, absent: 0, leave: 0, scheduledOff: 0, unmarked: 0, late: 0, daysWorked: 0, workedMinutes: 0 };
  for (const date of input.dates) {
    if (input.joinDate && date < input.joinDate) continue;
    if (input.exitDate && date > input.exitDate) continue;
    const row = input.attendance.get(date);
    if (row) {
      if (row.status === 'PRESENT') out.present++;
      else if (row.status === 'HALF_DAY') out.halfDay++;
      else if (row.status === 'ABSENT') out.absent++;
      else out.leave++;
      if ((row.status === 'PRESENT' || row.status === 'HALF_DAY') && row.checkInMinuteOfDay !== null) {
        const start = input.roster.get(date)?.shiftStartMinute;
        if (start !== null && start !== undefined && isLate(start, row.checkInMinuteOfDay)) out.late++;
      }
      out.workedMinutes += row.worked ?? 0;
      continue;
    }
    if (input.roster.has(date) && input.roster.get(date)!.shiftStartMinute === null) out.scheduledOff++;
    else out.unmarked++;
  }
  out.daysWorked = out.present + out.halfDay / 2;
  return out;
}
