/**
 * A billing rule's amount lives in its config, by calculation type. A rule with no amount bills
 * nothing — silently, for every flat, every month — so it is refused at creation rather than left to
 * be noticed on the sheet. (Water is not a rule: it is billed from meter readings under Water Billing.)
 */

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN);
const positive = (v: unknown) => Number.isFinite(num(v)) && num(v) > 0;

/** What kind of charge this is, for the label on the bill. Anything unrecognised is treated as a plain charge. */
export type ChargeType = 'MAINTENANCE' | 'CORPUS' | 'OTHER';
export const CHARGE_TYPES: ChargeType[] = ['MAINTENANCE', 'CORPUS', 'OTHER'];

export function chargeTypeOf(config: unknown): ChargeType | undefined {
  const t = (config as Record<string, unknown> | null)?.['chargeType'];
  return typeof t === 'string' && (CHARGE_TYPES as string[]).includes(t) ? (t as ChargeType) : undefined;
}

/** Why this rule cannot be created, or null when it will actually charge something. */
export function ruleConfigProblem(calculationType: string, config: Record<string, unknown> | undefined | null): string | null {
  const c = config ?? {};
  switch (calculationType) {
    case 'EQUAL_PER_FLAT':
    case 'FIXED_CUSTOM':
      return positive(c['amount']) ? null : 'Enter the amount to charge each flat.';
    case 'AREA_BASED':
      return positive(c['ratePerSqft']) ? null : 'Enter the rate per square foot.';
    case 'PER_PERSON':
      return positive(c['ratePerPerson']) ? null : 'Enter the rate per person.';
    case 'HYBRID':
      return positive(c['baseAmount']) || positive(c['areaRate']) ? null : 'Enter a base amount or an area rate.';
    case 'PERCENTAGE_BASED':
      return positive(c['percentage']) && positive(c['baseAmount']) ? null : 'Enter the percentage and the amount it is a percentage of.';
    case 'WATER_USAGE_BASED':
      return 'Water is billed from meter readings (Water Billing), not from a billing rule.';
    default:
      return `"${calculationType}" cannot be used to charge flats yet.`;
  }
}
