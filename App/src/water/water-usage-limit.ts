/**
 * A usage limit on water: each flat pays the normal rate for its units up to a limit, and the units
 * above it are charged more, either a percentage more per unit, a fixed rupee amount more per unit, or a
 * one-time fee for crossing the limit.
 *
 * The normal rate is untouched. For a flat that stays within the limit nothing changes at all; only the
 * units beyond the limit carry the extra. Pure functions with no database, so the rule is tested alone.
 *
 * A "unit" is whatever the readings are in (kilolitres on the meters here: 20 units is 20 KL = 20,000 L).
 */

import { Prisma } from '@prisma/client';

export const EXCESS_MODES = ['PERCENT', 'PER_UNIT', 'ONE_TIME'] as const;
export type ExcessMode = (typeof EXCESS_MODES)[number];

export interface UsageLimit {
  /** Units each flat may use at the normal rate. Units above this are charged more. */
  limitUnits: number;
  /** PERCENT: this % more per unit above the limit. PER_UNIT: this many rupees more per unit above it. ONE_TIME: this fee once, if the limit is crossed. */
  mode: ExcessMode;
  value: number;
}

export const MAX_LIMIT_UNITS = 100_000;
const MAX_BY_MODE: Record<ExcessMode, number> = { PERCENT: 1000, PER_UNIT: 100_000, ONE_TIME: 10_000_000 };

/** Why a limit is not acceptable, or null if it is. Accepts anything, since it may come from stored JSON. */
export function validateUsageLimit(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'The usage limit is missing.';
  const { limitUnits, mode, value } = raw as Record<string, unknown>;
  if (typeof limitUnits !== 'number' || !Number.isFinite(limitUnits) || limitUnits <= 0) {
    return 'The limit must be more than zero units.';
  }
  if (limitUnits > MAX_LIMIT_UNITS) return 'That limit is too large.';
  if (!EXCESS_MODES.includes(mode as ExcessMode)) return 'Choose how the units above the limit are charged.';
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'The extra charge cannot be negative.';
  const max = MAX_BY_MODE[mode as ExcessMode];
  if (value > max) return mode === 'PERCENT' ? 'The extra cannot be more than 1000%.' : 'That extra charge is too large.';
  if (new Prisma.Decimal(value).decimalPlaces() > 2) return 'The extra charge can have at most two decimal places.';
  return null;
}

/** The rule saved in a water configuration's JSON, or null when there is none (or it is not usable). */
export function readUsageLimit(config: unknown): UsageLimit | null {
  const raw = (config as { usageLimit?: unknown } | null)?.usageLimit;
  if (!raw || validateUsageLimit(raw) !== null) return null;
  const { limitUnits, mode, value } = raw as UsageLimit;
  return { limitUnits, mode, value };
}

export interface WaterCharge {
  /** Consumption × the normal rate, for every unit. */
  baseCharge: Prisma.Decimal;
  /** Units above the limit (0 when the flat stayed within it, or there is no limit). */
  excessUnits: Prisma.Decimal;
  /** What the units above the limit cost on top of the normal rate. */
  excessCharge: Prisma.Decimal;
  /** The rate per unit for units above the limit, or null for a one-time fee. */
  excessRate: Prisma.Decimal | null;
  /** The base plus the extra, to the paisa. */
  total: Prisma.Decimal;
}

/** The charge for one flat's consumption at the normal rate, with the limit applied if there is one. */
export function waterCharge(consumption: number, ratePerUnit: number, limit: UsageLimit | null): WaterCharge {
  const used = new Prisma.Decimal(consumption);
  const rate = new Prisma.Decimal(ratePerUnit);
  const baseCharge = used.times(rate);
  const zero = new Prisma.Decimal(0);

  if (!limit) return { baseCharge, excessUnits: zero, excessCharge: zero, excessRate: null, total: baseCharge.toDecimalPlaces(2) };

  const over = Prisma.Decimal.max(zero, used.minus(limit.limitUnits));
  let excessCharge = zero;
  let excessRate: Prisma.Decimal | null = null;

  if (limit.mode === 'PERCENT') {
    excessRate = rate.times(new Prisma.Decimal(100).plus(limit.value)).dividedBy(100);
    excessCharge = over.times(excessRate.minus(rate));
  } else if (limit.mode === 'PER_UNIT') {
    excessRate = rate.plus(limit.value);
    excessCharge = over.times(limit.value);
  } else {
    // A one-time fee: charged once, only when the limit is actually crossed.
    excessCharge = over.greaterThan(0) ? new Prisma.Decimal(limit.value) : zero;
  }

  return {
    baseCharge,
    excessUnits: over,
    excessCharge: excessCharge.toDecimalPlaces(2),
    excessRate,
    total: baseCharge.plus(excessCharge).toDecimalPlaces(2),
  };
}

/** The rule in plain words, for the bill and the screens. */
export function describeUsageLimit(limit: UsageLimit, unit = 'KL'): string {
  const head = `The first ${limit.limitUnits} ${unit} a flat uses are charged at the normal rate.`;
  if (limit.mode === 'PERCENT') return `${head} Each ${unit} above that costs ${limit.value}% more.`;
  if (limit.mode === 'PER_UNIT') return `${head} Each ${unit} above that costs ₹${limit.value} more.`;
  return `${head} A flat that goes above that pays a one-time fee of ₹${limit.value}.`;
}
