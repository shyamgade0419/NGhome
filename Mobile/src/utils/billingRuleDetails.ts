/**
 * What is inside a saved billing rule, as label/value rows: what it charges, when it applies, every
 * setting in its config, and each component. Opening a rule on a phone used to show a name and a date
 * and nothing else, so a rule's amount could not be seen. (Mirrors Web/lib/billingRuleDetails.ts.)
 */

import { KIND_LABEL, describeRule } from '@/utils/billingRules';
import type { ChargeKind } from '@/utils/billingRules';

export interface RuleDetailRow {
  label: string;
  value: string;
}

export interface RuleLike {
  name?: string;
  description?: string | null;
  calculationType?: string;
  isActive?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  priority?: number;
  config?: Record<string, unknown> | null;
  components?: {
    id?: string;
    name: string;
    componentType?: string;
    calculationType?: string;
    amount?: string | number | null;
    rate?: string | number | null;
    config?: Record<string, unknown> | null;
  }[];
}

const CALC_LABEL: Record<string, string> = {
  EQUAL_PER_FLAT: 'Same amount for every flat',
  AREA_BASED: 'Per square foot of the flat',
  PER_PERSON: 'Per resident',
  HYBRID: 'Base amount plus an area rate',
  FIXED_CUSTOM: 'Fixed charge',
  PERCENTAGE_BASED: 'Percentage of an amount',
  WATER_USAGE_BASED: 'Water usage',
  CUSTOM_FORMULA: 'Custom formula',
};

const CONFIG_LABEL: Record<string, string> = {
  amount: 'Amount per flat',
  ratePerSqft: 'Rate per sq ft',
  ratePerPerson: 'Rate per resident',
  baseAmount: 'Base amount',
  areaRate: 'Area rate (per sq ft)',
  percentage: 'Percentage',
  installments: 'Collected over (months)',
  total: 'Total to collect',
};

const MONEY_KEYS = new Set(['amount', 'ratePerSqft', 'ratePerPerson', 'baseAmount', 'areaRate', 'total']);

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Every setting in a config object, in words — nothing in it left unshown. */
function configRows(cfg: Record<string, unknown> | null | undefined): RuleDetailRow[] {
  const rows: RuleDetailRow[] = [];
  for (const [key, raw] of Object.entries(cfg ?? {})) {
    if (raw === null || raw === undefined || raw === '') continue;
    if (key === 'chargeType') {
      rows.push({ label: 'Kind of charge', value: KIND_LABEL[raw as ChargeKind] ?? String(raw) });
      continue;
    }
    const n = Number(raw);
    const value =
      MONEY_KEYS.has(key) && Number.isFinite(n) ? money(n) : key === 'percentage' && Number.isFinite(n) ? `${n}%` : String(raw);
    rows.push({ label: CONFIG_LABEL[key] ?? key, value });
  }
  return rows;
}

export function ruleDetailRows(rule: RuleLike): {
  summary: RuleDetailRow[];
  components: { title: string; rows: RuleDetailRow[] }[];
} {
  const summary: RuleDetailRow[] = [
    { label: 'Status', value: rule.isActive === false ? 'Inactive — not used for new bills' : 'Active' },
    { label: 'Charges', value: describeRule(rule) },
    { label: 'Worked out', value: CALC_LABEL[rule.calculationType ?? ''] ?? (rule.calculationType ?? '').replace(/_/g, ' ') },
    ...configRows(rule.config),
    { label: 'Applies from', value: day(rule.effectiveFrom) || '—' },
    { label: 'Applies until', value: day(rule.effectiveTo) || 'Until changed' },
  ];
  if (rule.priority) summary.push({ label: 'Priority', value: String(rule.priority) });
  if (rule.description) summary.push({ label: 'Description', value: rule.description });

  const components = (rule.components ?? []).map((c) => {
    const rows: RuleDetailRow[] = [];
    if (c.componentType) rows.push({ label: 'Type', value: c.componentType.replace(/_/g, ' ').toLowerCase() });
    if (c.calculationType) rows.push({ label: 'Worked out', value: CALC_LABEL[c.calculationType] ?? c.calculationType.replace(/_/g, ' ') });
    if (c.amount !== null && c.amount !== undefined && Number(c.amount) !== 0) rows.push({ label: 'Amount', value: money(Number(c.amount)) });
    if (c.rate !== null && c.rate !== undefined && Number(c.rate) !== 0) rows.push({ label: 'Rate', value: money(Number(c.rate)) });
    rows.push(...configRows(c.config));
    return { title: c.name, rows };
  });
  return { summary, components };
}
