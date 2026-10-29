import { SlotFor, VehicleKind } from '@prisma/client';

/**
 * A number plate reduced to what identifies it: upper-case letters and digits, no spaces, dashes
 * or dots. "ts 09 ab-1234", "TS09AB1234" and "Ts-09-Ab-1234" are one vehicle. Null when it cannot
 * be a plate (the database also checks 4-12 characters).
 */
export function normalizePlate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const plate = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{4,12}$/.test(plate) ? plate : null;
}

/** A search typed at the gate: as much of a plate as the guard knows, usually the last digits. */
export function normalizeSearch(input: unknown): string {
  return typeof input === 'string' ? input.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export const VEHICLE_LIMITS = {
  /** Vehicles one flat may have registered at once. */
  perFlat: 6,
  /** Slots one bulk request may create. */
  bulkSlots: 200,
  /** The fewest characters a gate lookup accepts, so it cannot be used to list every vehicle. */
  minSearch: 3,
} as const;

/** Whether a vehicle of this kind may use a slot meant for that: a car slot takes cars, a two-wheeler slot takes two-wheelers and cycles, "any" takes anything. */
export function fitsSlot(kind: VehicleKind, slotFor: SlotFor): boolean {
  if (slotFor === SlotFor.ANY) return true;
  if (slotFor === SlotFor.CAR) return kind === VehicleKind.CAR;
  return kind === VehicleKind.TWO_WHEELER || kind === VehicleKind.CYCLE;
}

/**
 * The codes a bulk request makes: prefix + number, e.g. B1- and 1..3 with pad 2 -> B1-01, B1-02,
 * B1-03. Null when the range is backwards or larger than the limit.
 */
export function bulkCodes(prefix: string, from: number, to: number, pad: number): string[] | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return null;
  if (to - from + 1 > VEHICLE_LIMITS.bulkSlots) return null;
  const codes: string[] = [];
  for (let n = from; n <= to; n++) codes.push(`${prefix}${String(n).padStart(pad, '0')}`);
  return codes;
}
