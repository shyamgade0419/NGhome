/**
 * Vehicle and parking types and labels for the committee's web page. The server owns every rule;
 * this only describes what it returns.
 */

export type VehicleKind = 'CAR' | 'TWO_WHEELER' | 'CYCLE' | 'OTHER';
export type SlotFor = 'CAR' | 'TWO_WHEELER' | 'ANY';
export type SlotStatus = 'FREE' | 'ALLOCATED' | 'VISITOR';

export interface VehicleRow {
  id: string;
  plate: string;
  kind: VehicleKind;
  make: string | null;
  colour: string | null;
  active: boolean;
  flatCode: string;
  slotCodes: string[];
  createdAt: string;
  removedAt: string | null;
  removedReason: string | null;
}

export interface SlotRow {
  id: string;
  code: string;
  area: string | null;
  slotFor: SlotFor;
  visitor: boolean;
  flatId: string | null;
  flatCode: string | null;
  vehiclePlate: string | null;
  vehicleKind: VehicleKind | null;
}

export const KIND_LABEL: Record<VehicleKind, string> = { CAR: 'Car', TWO_WHEELER: 'Bike / scooter', CYCLE: 'Cycle', OTHER: 'Other' };
export const SLOT_FOR_LABEL: Record<SlotFor, string> = { CAR: 'Car', TWO_WHEELER: 'Two-wheeler', ANY: 'Any vehicle' };

export const SLOT_FOR_OPTIONS = (Object.keys(SLOT_FOR_LABEL) as SlotFor[]).map((v) => ({ value: v, label: SLOT_FOR_LABEL[v] }));

export const SLOT_STATUS_OPTIONS: { value: '' | SlotStatus; label: string }[] = [
  { value: '', label: 'All slots' },
  { value: 'FREE', label: 'Free' },
  { value: 'ALLOCATED', label: 'Allocated' },
  { value: 'VISITOR', label: 'Visitor' },
];

/** "TS09AB1234" -> "TS09 AB 1234", the way Indian plates read; anything else as it is. */
export function formatPlate(plate: string): string {
  const m = /^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{1,4})$/.exec(plate);
  return m ? `${m[1]}${m[2]} ${m[3]} ${m[4]}` : plate;
}

/** The slots a bulk request would make, for the preview ("B1-01 to B1-40, 40 slots"); null when the range is not usable. */
export function bulkPreview(prefix: string, from: number, to: number, pad: number, max = 200): { first: string; last: string; count: number } | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return null;
  const count = to - from + 1;
  if (count > max) return null;
  const code = (n: number) => `${prefix}${String(n).padStart(pad, '0')}`;
  return { first: code(from), last: code(to), count };
}
