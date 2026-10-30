/**
 * Staff attendance types and labels for the committee's web page. The server owns every rule; this
 * only describes what it returns and does the small date arithmetic the screens need.
 */

export type AttendanceStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE';

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  overnight: boolean;
  active: boolean;
}

export interface DayAttendance {
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  note: string | null;
  workedMinutes: number | null;
  late: boolean;
}

export interface DayRow {
  employeeId: string;
  name: string;
  designation: string;
  shift: Shift | null;
  post: string | null;
  dayOff: boolean;
  attendance: DayAttendance | null;
}

export interface RosterRow {
  employeeId: string;
  date: string;
  post: string | null;
  shift: Shift | null;
  dayOff: boolean;
}

export interface SummaryRow {
  employeeId: string;
  name: string;
  designation: string;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  scheduledOff: number;
  unmarked: number;
  late: number;
  daysWorked: number;
  workedMinutes: number;
}

export interface MonthDay {
  date: string;
  shift: Shift | null;
  post: string | null;
  dayOff: boolean;
  attendance: DayAttendance | null;
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export const STATUS_LABEL: Record<AttendanceStatus, string> = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave' };
export const STATUS_VARIANT: Record<AttendanceStatus, BadgeVariant> = { PRESENT: 'success', HALF_DAY: 'warning', ABSENT: 'danger', LEAVE: 'info' };

export const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as AttendanceStatus[]).map((v) => ({ value: v, label: STATUS_LABEL[v] }));

export const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

const DAY_MS = 86_400_000;

/** Today's date in India time, "YYYY-MM-DD", whatever the browser's own time zone is. */
export const istToday = (now: Date = new Date()): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export const addDays = (date: string, n: number): string => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** The Monday on or before a date. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** "Fri 30 Oct". */
export const dayLabel = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The month ("YYYY-MM") of a date, and the month before or after it. */
export const monthOf = (date: string): string => date.slice(0, 7);
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "8 h 5 min", "45 min", or "—" when there is nothing to show. */
export function hours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

/** "06:00–14:00", marking a shift that runs past midnight. */
export const shiftSpan = (s: Pick<Shift, 'startTime' | 'endTime' | 'overnight'>): string => `${s.startTime}–${s.endTime}${s.overnight ? ' (+1)' : ''}`;
