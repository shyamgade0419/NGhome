/**
 * The committee's amenity form: text fields in, a validated API payload out.
 * Kept pure so every rule can be tested without rendering the form. The server
 * re-validates everything — this exists so a mistake is caught at the field,
 * with a sentence a person can act on, instead of as a generic 400.
 */

import type { Amenity, AmenityBookingMode, AmenityPayload } from '@/api/endpoints/amenities.api';
import { minutesToHHMM, parseHHMM } from '@/utils/amenity-time';

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
