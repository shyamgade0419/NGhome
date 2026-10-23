/**
 * Amenity booking — India-time formatting and the committee's space form.
 * Mirrors Mobile/src/utils/amenity-time.ts and amenity-form.ts (the two apps
 * don't share a package). Times are formatted by hand, not through Intl's
 * timeZone option, so a slot always reads in India time whatever zone the
 * viewer's computer is set to.
 */

export type AmenityBookingMode = 'INSTANT' | 'NEEDS_APPROVAL';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export type FeeStatus = 'NONE' | 'DUE' | 'COLLECTED' | 'WAIVED';

export interface Amenity {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  bookingMode: AmenityBookingMode;
  slotMinutes: number;
  opensAtMin: number;
  closesAtMin: number;
  maxAdvanceDays: number;
  monthlyCapPerFlat: number | null;
  cancelBeforeHours: number;
  capacity: number;
  maxSlotsPerBooking: number;
  fee: string | null;
  isActive: boolean;
}

export interface AmenityPayload {
  name?: string;
  description?: string;
  rules?: string;
  bookingMode?: AmenityBookingMode;
  slotMinutes?: number;
  opensAtMin?: number;
  closesAtMin?: number;
  maxAdvanceDays?: number;
  monthlyCapPerFlat?: number | null;
  cancelBeforeHours?: number;
  capacity?: number;
  maxSlotsPerBooking?: number;
  fee?: number;
  isActive?: boolean;
}

export interface AmenityBooking {
  id: string;
  amenityId: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  guestCount: number;
  note: string | null;
  feeAmount: string;
  feeStatus: FeeStatus;
  rejectionReason: string | null;
  amenity?: { id: string; name: string };
  flat?: { id: string; flatCode: string };
  user?: { id: string; firstName: string; lastName: string };
}

const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ist(input: string | Date): Date {
  return new Date(new Date(input).getTime() + IST_OFFSET_MS);
}

export function fmtTime(input: string | Date): string {
  const d = ist(input);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDayOf(input: string | Date): string {
  const d = ist(input);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Wed, 4 Nov · 6:00 PM – 7:00 PM" */
export function fmtRange(startAt: string | Date, endAt: string | Date): string {
  return `${fmtDayOf(startAt)} · ${fmtTime(startAt)} – ${fmtTime(endAt)}`;
}

/** 360 -> "06:00" */
export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** "06:00" / "6:00" -> minutes since midnight, or null. "24:00" is allowed (end of day). */
export function parseHHMM(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/** 360 -> "6:00 AM" */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export interface AmenityForm {
  name: string;
  description: string;
  rules: string;
  bookingMode: AmenityBookingMode;
  /** "06:00" — India time. */
  opens: string;
  closes: string;
  slotMinutes: string;
  capacity: string;
  maxSlots: string;
  advanceDays: string;
  /** Blank means no monthly limit. */
  monthlyCap: string;
  cancelHours: string;
  /** Blank or 0 means free. */
  fee: string;
  isActive: boolean;
}

export const EMPTY_FORM: AmenityForm = {
  name: '',
  description: '',
  rules: '',
  bookingMode: 'INSTANT',
  opens: '06:00',
  closes: '22:00',
  slotMinutes: '60',
  capacity: '1',
  maxSlots: '1',
  advanceDays: '30',
  monthlyCap: '',
  cancelHours: '24',
  fee: '',
  isActive: true,
};

export function formFromAmenity(a: Amenity): AmenityForm {
  return {
    name: a.name,
    description: a.description ?? '',
    rules: a.rules ?? '',
    bookingMode: a.bookingMode,
    opens: minutesToHHMM(a.opensAtMin),
    closes: minutesToHHMM(a.closesAtMin),
    slotMinutes: String(a.slotMinutes),
    capacity: String(a.capacity),
    maxSlots: String(a.maxSlotsPerBooking),
    advanceDays: String(a.maxAdvanceDays),
    monthlyCap: a.monthlyCapPerFlat ? String(a.monthlyCapPerFlat) : '',
    cancelHours: String(a.cancelBeforeHours),
    fee: a.fee && Number(a.fee) > 0 ? String(Number(a.fee)) : '',
    isActive: a.isActive,
  };
}

export type FormResult = { ok: true; payload: AmenityPayload } | { ok: false; error: string };

function wholeNumber(text: string, label: string, min: number, max: number): number | string {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return `${label} must be a whole number.`;
  const n = Number(trimmed);
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
  return n;
}

export function buildAmenityPayload(form: AmenityForm): FormResult {
  const name = form.name.trim();
  if (!name) return { ok: false, error: 'Give the amenity a name.' };
  if (name.length > 80) return { ok: false, error: 'The name is too long (80 characters at most).' };

  const opensAtMin = parseHHMM(form.opens);
  const closesAtMin = parseHHMM(form.closes);
  if (opensAtMin === null) return { ok: false, error: 'Opening time must look like 06:00.' };
  if (closesAtMin === null) return { ok: false, error: 'Closing time must look like 22:00.' };
  if (opensAtMin >= 1440) return { ok: false, error: 'Opening time must be before midnight.' };
  if (closesAtMin <= opensAtMin) return { ok: false, error: 'Closing time must be after opening time.' };

  const slotMinutes = wholeNumber(form.slotMinutes, 'Slot length', 15, 480);
  if (typeof slotMinutes === 'string') return { ok: false, error: slotMinutes };
  const window = closesAtMin - opensAtMin;
  if (slotMinutes > window) return { ok: false, error: 'A slot is longer than the time the amenity is open.' };

  const capacity = wholeNumber(form.capacity, 'Bookings per slot', 1, 50);
  if (typeof capacity === 'string') return { ok: false, error: capacity };

  const maxSlots = wholeNumber(form.maxSlots, 'Slots per booking', 1, 24);
  if (typeof maxSlots === 'string') return { ok: false, error: maxSlots };
  if (maxSlots * slotMinutes > window) {
    return { ok: false, error: 'The longest booking does not fit within opening hours. Lower the slots per booking.' };
  }

  const advanceDays = wholeNumber(form.advanceDays, 'Days ahead', 1, 365);
  if (typeof advanceDays === 'string') return { ok: false, error: advanceDays };

  const cancelHours = wholeNumber(form.cancelHours, 'Cancellation notice', 0, 720);
  if (typeof cancelHours === 'string') return { ok: false, error: cancelHours };

  let monthlyCapPerFlat: number | null = null;
  if (form.monthlyCap.trim() !== '') {
    const cap = wholeNumber(form.monthlyCap, 'Monthly limit', 1, 100);
    if (typeof cap === 'string') return { ok: false, error: cap };
    monthlyCapPerFlat = cap;
  }

  let fee = 0;
  if (form.fee.trim() !== '') {
    if (!/^\d+(\.\d{1,2})?$/.test(form.fee.trim())) return { ok: false, error: 'Fee must be an amount like 500 or 499.50.' };
    fee = Number(form.fee.trim());
    if (fee > 1_000_000) return { ok: false, error: 'Fee is too large.' };
  }

  return {
    ok: true,
    payload: {
      name,
      description: form.description.trim(),
      rules: form.rules.trim(),
      bookingMode: form.bookingMode,
      slotMinutes,
      opensAtMin,
      closesAtMin,
      maxAdvanceDays: advanceDays,
      monthlyCapPerFlat,
      cancelBeforeHours: cancelHours,
      capacity,
      maxSlotsPerBooking: maxSlots,
      fee,
      isActive: form.isActive,
    },
  };
}
