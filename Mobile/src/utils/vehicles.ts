/**
 * Vehicle and parking logic that does not need a screen, kept pure so every rule (how a plate
 * reads, which vehicle fits which slot, when a lookup may run) is testable. The server enforces
 * all of it again; this only decides what to offer.
 */

import type { MySlot, MyVehicle, SlotFor, VehicleKind } from '@/api/endpoints/vehicles.api';

export const VEHICLE_KINDS: { value: VehicleKind; label: string }[] = [
  { value: 'CAR', label: 'Car' },
  { value: 'TWO_WHEELER', label: 'Bike / scooter' },
  { value: 'CYCLE', label: 'Cycle' },
  { value: 'OTHER', label: 'Other' },
];

export const kindLabel = (k: VehicleKind): string => VEHICLE_KINDS.find((x) => x.value === k)?.label ?? 'Vehicle';

export const SLOT_FOR_LABEL: Record<SlotFor, string> = { CAR: 'Car slot', TWO_WHEELER: 'Two-wheeler slot', ANY: 'Any vehicle' };

/** The most vehicles one flat may register (the server refuses more). */
export const MAX_VEHICLES_PER_FLAT = 6;

/** The fewest characters a gate lookup accepts. */
export const MIN_LOOKUP = 3;

/** A plate as typed, reduced to upper-case letters and digits (the server does the same). */
export const tidyPlate = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** Whether what was typed can be a plate: 4 to 12 letters and digits. */
export const isValidPlate = (text: string): boolean => /^[A-Z0-9]{4,12}$/.test(tidyPlate(text));

/** "TS09AB1234" -> "TS09 AB 1234", the way Indian plates read; anything that does not fit that shape is shown as it is. */
export function formatPlate(plate: string): string {
  const m = /^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{1,4})$/.exec(plate);
  return m ? `${m[1]}${m[2]} ${m[3]} ${m[4]}` : plate;
}

/** A guard's lookup may run once enough of the number is typed. */
export const canLookup = (text: string): boolean => tidyPlate(text).length >= MIN_LOOKUP;

/** Whether a vehicle of this kind may use a slot meant for that (mirrors the server's rule). */
export function fitsSlot(kind: VehicleKind, slotFor: SlotFor): boolean {
  if (slotFor === 'ANY') return true;
  if (slotFor === 'CAR') return kind === 'CAR';
  return kind === 'TWO_WHEELER' || kind === 'CYCLE';
}

/** The household's vehicles that could go in this slot. */
export const vehiclesForSlot = <V extends Pick<MyVehicle, 'kind'>>(vehicles: V[], slot: Pick<MySlot, 'slotFor'>): V[] => vehicles.filter((v) => fitsSlot(v.kind, slot.slotFor));

/** "Maruti Swift · White", or just the kind when nothing else is known. */
export function vehicleSubtitle(v: Pick<MyVehicle, 'kind' | 'make' | 'colour'>): string {
  const detail = [v.make, v.colour].filter(Boolean).join(' · ');
  return detail || kindLabel(v.kind);
}

/** "Slot B1-12" or "Slots B1-12, B1-13" for where a vehicle is parked; null when it is in none. */
export function parkedAt(v: Pick<MyVehicle, 'slots'>): string | null {
  if (!v.slots.length) return null;
  const codes = v.slots.map((s) => s.code).sort().join(', ');
  return v.slots.length === 1 ? `Slot ${codes}` : `Slots ${codes}`;
}
