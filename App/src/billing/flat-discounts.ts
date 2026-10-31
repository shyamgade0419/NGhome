import { Prisma } from '@prisma/client';

export interface DiscountRule {
  type: 'FIXED' | 'PERCENT';
  value: Prisma.Decimal;
  reason: string;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** A discount is in force for a billing period when the period starts within its dates. */
export function inForce(d: Pick<DiscountRule, 'isActive' | 'effectiveFrom' | 'effectiveTo'>, periodStart: Date): boolean {
  if (!d.isActive) return false;
  if (d.effectiveFrom.getTime() > periodStart.getTime()) return false;
  return d.effectiveTo === null || d.effectiveTo.getTime() >= periodStart.getTime();
}

/** Why a discount is not being applied right now, for the list: in force, waiting to start, finished, or switched off. */
export function discountStatus(d: Pick<DiscountRule, 'isActive' | 'effectiveFrom' | 'effectiveTo'>, now: Date): 'ACTIVE' | 'SCHEDULED' | 'ENDED' | 'OFF' {
  if (!d.isActive) return 'OFF';
  if (d.effectiveFrom.getTime() > now.getTime()) return 'SCHEDULED';
  if (d.effectiveTo !== null && d.effectiveTo.getTime() < now.getTime()) return 'ENDED';
  return 'ACTIVE';
}

export interface AppliedDiscount {
  total: Prisma.Decimal;
  /** The reasons of the discounts that took something off, for the bill line. */
  reasons: string[];
}

/**
 * What the discounts in force take off a flat's bill for `base` (its maintenance and charges, before water).
 * A fixed amount is taken as it is; a percentage is of `base`. Together they never exceed `base`, so a bill
 * cannot be pushed below what it would cost without them.
 */
export function discountFor(discounts: DiscountRule[], base: Prisma.Decimal, periodStart: Date): AppliedDiscount {
  let total = new Prisma.Decimal(0);
  const reasons: string[] = [];
  for (const d of discounts) {
    if (!inForce(d, periodStart)) continue;
    const amount = d.type === 'FIXED' ? d.value : base.mul(d.value).div(100).toDecimalPlaces(2);
    const room = base.minus(total);
    if (room.lessThanOrEqualTo(0)) break;
    const take = amount.lessThan(room) ? amount : room;
    if (take.lessThanOrEqualTo(0)) continue;
    total = total.plus(take);
    reasons.push(d.reason);
  }
  return { total, reasons };
}
