import { DeliveryExpectation, DeliveryExpectationStatus } from '@prisma/client';

export const EXPECTATION_LIMITS = {
  /** How long an instruction lasts when the resident gives no end time. */
  defaultHours: 12,
  /** The longest an instruction may last. */
  maxHours: 72,
  /** The most deliveries one instruction may admit. */
  maxUses: 10,
} as const;

export type ExpectationState = 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'CANCELLED';

/** What a person looking at an instruction should see: its status, with time and use folded in. */
export function expectationState(
  e: Pick<DeliveryExpectation, 'status' | 'validFrom' | 'validUntil' | 'usedCount' | 'maxUses' | 'instruction'>,
  now: Date,
): ExpectationState {
  if (e.status === DeliveryExpectationStatus.CANCELLED) return 'CANCELLED';
  if (now > e.validUntil) return 'EXPIRED';
  // Only ALLOW_ENTRY is spent; "leave it at the gate" applies for the whole window.
  if (e.instruction === 'ALLOW_ENTRY' && e.usedCount >= e.maxUses) return 'USED';
  if (now < e.validFrom) return 'NOT_YET';
  return 'ACTIVE';
}
