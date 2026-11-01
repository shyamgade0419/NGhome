/**
 * The water usage limit, on the web: each flat pays the normal rate up to a limit, and the units above it
 * are charged more. These mirror the rules the server applies (App/src/water/water-usage-limit.ts), so the
 * preview on the page matches what is saved; the server is the one that decides.
 */

export type ExcessMode = 'PERCENT' | 'PER_UNIT' | 'ONE_TIME';

export interface UsageLimit {
  limitUnits: number;
  mode: ExcessMode;
  value: number;
}

/** What the form holds: text, so a half-typed number is never lost. */
export interface UsageLimitForm {
  enabled: boolean;
  limitUnits: string;
  mode: ExcessMode;
  value: string;
}

export const DEFAULT_LIMIT_FORM: UsageLimitForm = { enabled: false, limitUnits: '20', mode: 'PERCENT', value: '25' };

export const MODE_OPTIONS: { value: ExcessMode; label: string; suffix: string; hint: string }[] = [
  { value: 'PERCENT', label: '% more per unit', suffix: '%', hint: 'Each unit above the limit costs this much more than the normal rate.' },
  { value: 'PER_UNIT', label: '₹ more per unit', suffix: '₹ / unit', hint: 'Each unit above the limit costs this many rupees more than the normal rate.' },
  { value: 'ONE_TIME', label: 'One-time fee', suffix: '₹', hint: 'A flat that goes above the limit pays this fee once, however far above it goes.' },
];

/** The form for a rule saved on the server, or the empty (off) form when there is none. */
export function formFromSaved(saved: UsageLimit | null | undefined): UsageLimitForm {
  if (!saved) return DEFAULT_LIMIT_FORM;
  return { enabled: true, limitUnits: String(saved.limitUnits), mode: saved.mode, value: String(saved.value) };
}

/** Why the form cannot be used, or null. Only checked while the rule is switched on. */
export function validateLimitForm(form: UsageLimitForm): string | null {
  if (!form.enabled) return null;
  const limit = Number(form.limitUnits);
  const value = Number(form.value);
  if (!form.limitUnits.trim() || !Number.isFinite(limit) || limit <= 0) return 'Enter how many units a flat may use at the normal rate (more than zero).';
  if (limit > 100_000) return 'That limit is too large.';
  if (form.value.trim() === '' || !Number.isFinite(value) || value < 0) return 'Enter the extra charge (zero or more).';
  if (!/^\d+(\.\d{1,2})?$/.test(form.value.trim())) return 'The extra charge can have at most two decimal places.';
  if (form.mode === 'PERCENT' && value > 1000) return 'The extra cannot be more than 1000%.';
  return null;
}

/** The rule to apply, or null when it is off or not valid. */
export function limitFromForm(form: UsageLimitForm): UsageLimit | null {
  if (!form.enabled || validateLimitForm(form) !== null) return null;
  return { limitUnits: Number(form.limitUnits), mode: form.mode, value: Number(form.value) };
}

const paisa = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FlatCharge {
  base: number;
  excessUnits: number;
  excess: number;
  total: number;
}

/** One flat's charge at the normal rate, with the limit applied if there is one. */
export function chargeFor(consumption: number, ratePerUnit: number, limit: UsageLimit | null): FlatCharge {
  const base = consumption * ratePerUnit;
  if (!limit) return { base, excessUnits: 0, excess: 0, total: paisa(base) };
  const over = Math.max(0, consumption - limit.limitUnits);
  let excess = 0;
  if (limit.mode === 'PERCENT') excess = over * ratePerUnit * (limit.value / 100);
  else if (limit.mode === 'PER_UNIT') excess = over * limit.value;
  else excess = over > 0 ? limit.value : 0;
  return { base, excessUnits: over, excess: paisa(excess), total: paisa(base + excess) };
}

/** The rule in plain words, with the real rate worked in when it is known. */
export function describeLimit(limit: UsageLimit, ratePerUnit = 0): string {
  const head = `Each flat's first ${limit.limitUnits} KL are charged at the normal rate`;
  const rate = (n: number) => `₹${paisa(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  if (limit.mode === 'PERCENT') {
    const over = ratePerUnit > 0 ? ` (${rate(ratePerUnit)} becomes ${rate(ratePerUnit * (1 + limit.value / 100))} a KL)` : '';
    return `${head}. Each KL above that costs ${limit.value}% more${over}.`;
  }
  if (limit.mode === 'PER_UNIT') {
    const over = ratePerUnit > 0 ? ` (${rate(ratePerUnit)} becomes ${rate(ratePerUnit + limit.value)} a KL)` : '';
    return `${head}. Each KL above that costs ${rate(limit.value)} more${over}.`;
  }
  return `${head}. A flat that goes above that pays a one-time fee of ${rate(limit.value)}.`;
}
