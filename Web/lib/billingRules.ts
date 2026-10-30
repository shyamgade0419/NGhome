/**
 * The billing rule form: regular maintenance, a corpus, or another charge — set once and charged to
 * every flat. Builds the payload the API expects, and describes a saved rule in words.
 * (Mirrors Mobile/src/utils/billingRules.ts.)
 */

export type ChargeKind = 'MAINTENANCE' | 'CORPUS' | 'OTHER';
export type Basis = 'EQUAL_PER_FLAT' | 'AREA_BASED' | 'PER_PERSON';

export const KIND_LABEL: Record<ChargeKind, string> = {
  MAINTENANCE: 'Regular maintenance',
  CORPUS: 'Corpus fund',
  OTHER: 'Other charge',
};

export const BASIS_LABEL: Record<Basis, string> = {
  EQUAL_PER_FLAT: 'Same amount for every flat',
  AREA_BASED: 'Per square foot of the flat',
  PER_PERSON: 'Per resident',
};

export interface RuleForm {
  kind: ChargeKind;
  name: string;
  basis: Basis;
  /** Maintenance/other: the amount (or rate) each month. Corpus: the whole amount (or rate) to collect. */
  amount: string;
  /** Corpus only: how many monthly instalments (1 = collected in one go). */
  installments: string;
  /** Corpus only: the month the first instalment is billed, YYYY-MM. */
  startMonth: string;
  /** Maintenance/other: first day it applies, YYYY-MM-DD. */
  effectiveFrom: string;
  /** Maintenance/other: last day it applies — blank means until changed. */
  effectiveTo: string;
}

const KEY: Record<Basis, string> = { EQUAL_PER_FLAT: 'amount', AREA_BASED: 'ratePerSqft', PER_PERSON: 'ratePerPerson' };
const SUFFIX: Record<Basis, string> = { EQUAL_PER_FLAT: 'per flat', AREA_BASED: 'per sq ft', PER_PERSON: 'per resident' };

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pad = (n: number) => String(n).padStart(2, '0');

/** Last day of the month that is `count - 1` months after `startMonth` (YYYY-MM), as YYYY-MM-DD. */
export function lastDayAfter(startMonth: string, count: number): string {
  const [y, m] = startMonth.split('-').map(Number);
  // Day 0 of the month after the last instalment's month is that month's last day.
  const end = new Date(Date.UTC(y, m - 1 + count, 0));
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
}

export function buildRulePayload(f: RuleForm): { payload: Record<string, unknown> } | { error: string } {
  const name = f.name.trim();
  if (!name) return { error: 'Give the charge a name.' };
  const value = parseFloat(f.amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { error: f.basis === 'EQUAL_PER_FLAT' ? 'Enter the amount to charge each flat.' : 'Enter the rate.' };
  }

  if (f.kind === 'CORPUS') {
    const n = parseInt(f.installments || '1', 10);
    if (!Number.isInteger(n) || n < 1 || n > 60) return { error: 'Instalments must be between 1 and 60 months.' };
    if (!/^\d{4}-\d{2}$/.test(f.startMonth)) return { error: 'Choose the month the first instalment is billed.' };
    const each = Math.round((value / n) * 100) / 100;
    return {
      payload: {
        name,
        calculationType: f.basis,
        effectiveFrom: new Date(`${f.startMonth}-01T00:00:00.000Z`).toISOString(),
        effectiveTo: new Date(`${lastDayAfter(f.startMonth, n)}T00:00:00.000Z`).toISOString(),
        priority: 2,
        config: { [KEY[f.basis]]: each, chargeType: 'CORPUS', installments: n, total: value },
      },
    };
  }

  if (!f.effectiveFrom) return { error: 'Choose the first day this applies.' };
  if (f.effectiveTo && f.effectiveTo < f.effectiveFrom) return { error: '"Until" cannot be before the first day.' };
  return {
    payload: {
      name,
      calculationType: f.basis,
      effectiveFrom: new Date(`${f.effectiveFrom}T00:00:00.000Z`).toISOString(),
      effectiveTo: f.effectiveTo ? new Date(`${f.effectiveTo}T00:00:00.000Z`).toISOString() : undefined,
      priority: f.kind === 'MAINTENANCE' ? 1 : 3,
      config: { [KEY[f.basis]]: value, chargeType: f.kind },
    },
  };
}

/** "₹2,500 per flat · Regular maintenance" — what a saved rule charges, in words. */
export function describeRule(rule: { calculationType?: string; config?: Record<string, unknown> | null }): string {
  const basis = rule.calculationType as Basis;
  const cfg = rule.config ?? {};
  const key = KEY[basis];
  const raw = key ? Number(cfg[key]) : NaN;
  const kind = typeof cfg.chargeType === 'string' ? KIND_LABEL[cfg.chargeType as ChargeKind] : undefined;
  if (!key || !Number.isFinite(raw) || raw <= 0) return kind ?? 'No amount set — this rule charges nothing';
  const parts = [`${money(raw)} ${SUFFIX[basis]}`];
  const n = Number(cfg.installments);
  if (kind === KIND_LABEL.CORPUS && n > 1) parts[0] = `${money(raw)} ${SUFFIX[basis]} a month for ${n} months`;
  if (kind) parts.push(kind);
  return parts.join(' · ');
}
