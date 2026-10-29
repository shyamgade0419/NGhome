/**
 * Delivery logic that does not need a screen, kept pure so every rule (which
 * button a guard sees, what a resident can choose, how an instruction reads)
 * is testable. The server enforces all of it again; this only decides what to offer.
 */

import type { DeliveryExpectation, DeliveryInstruction, ExpectationState, Parcel, ParcelStatus } from '@/api/endpoints/deliveries.api';
import { fmtDayOf, fmtTime } from '@/utils/amenity-time';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

/** Quick picks for who is delivering; the resident can still type any name. */
export const COMPANIES = ['Amazon', 'Flipkart', 'Swiggy', 'Zomato', 'Zepto', 'Blinkit', 'Courier'] as const;

export const INSTRUCTIONS: { value: DeliveryInstruction; label: string; hint: string }[] = [
  { value: 'ALLOW_ENTRY', label: 'Send them up', hint: 'The guard lets the delivery person in without calling you.' },
  { value: 'LEAVE_AT_GATE', label: 'Leave at gate', hint: 'The guard keeps the parcel and tells you when it arrives.' },
];

export const instructionLabel = (i: DeliveryInstruction): string => INSTRUCTIONS.find((x) => x.value === i)?.label ?? 'Delivery';

export const DELIVERY_DURATIONS: { label: string; hours: number }[] = [
  { label: '3 hours', hours: 3 },
  { label: '12 hours', hours: 12 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
];

export const EXPECTATION_STATE: Record<ExpectationState, { label: string; variant: Variant }> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  NOT_YET: { label: 'Starts later', variant: 'info' },
  USED: { label: 'Used', variant: 'neutral' },
  EXPIRED: { label: 'Expired', variant: 'neutral' },
  CANCELLED: { label: 'Cancelled', variant: 'error' },
};

export const PARCEL_STATUS: Record<ParcelStatus, { label: string; variant: Variant }> = {
  RECEIVED: { label: 'At the gate', variant: 'warning' },
  COLLECTED: { label: 'Collected', variant: 'success' },
  RETURNED: { label: 'Sent back', variant: 'neutral' },
};

/** An instruction a resident can still withdraw. */
export const canCancel = (e: Pick<DeliveryExpectation, 'state'>): boolean => e.state === 'ACTIVE' || e.state === 'NOT_YET';

/** The guard can hand over or send back only a parcel still at the gate. */
export const isHeld = (p: Pick<Parcel, 'status'>): boolean => p.status === 'RECEIVED';

/** "Send them up · Amazon · until Today, 6:10 PM", or how many are left for a multi-use instruction. */
export function expectationSummary(e: Pick<DeliveryExpectation, 'company' | 'instruction' | 'validUntil' | 'maxUses' | 'usedCount'>): string {
  const parts = [instructionLabel(e.instruction), e.company, `until ${fmtDayOf(e.validUntil)}, ${fmtTime(e.validUntil)}`];
  if (e.instruction === 'ALLOW_ENTRY' && e.maxUses > 1) parts.push(`${e.usedCount} of ${e.maxUses} used`);
  return parts.join(' · ');
}

/** "Arrived Today, 6:10 PM · Collected 7:05 PM". */
export function parcelTimeline(p: Pick<Parcel, 'receivedAt' | 'closedAt' | 'status'>): string {
  const parts = [`Arrived ${fmtDayOf(p.receivedAt)}, ${fmtTime(p.receivedAt)}`];
  if (p.closedAt) parts.push(`${p.status === 'RETURNED' ? 'Sent back' : 'Collected'} ${fmtTime(p.closedAt)}`);
  return parts.join(' · ');
}

/** The live instruction the guard should know about for a flat, "leave at gate" first since it changes what they do. */
export function instructionsForFlat(list: DeliveryExpectation[], flatId: string | null | undefined): DeliveryExpectation[] {
  if (!flatId) return [];
  return list.filter((e) => e.flatId === flatId).sort((a, b) => Number(b.instruction === 'LEAVE_AT_GATE') - Number(a.instruction === 'LEAVE_AT_GATE'));
}
