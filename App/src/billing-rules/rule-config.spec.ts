import { chargeTypeOf, ruleConfigProblem } from './rule-config';

describe('a billing rule must carry an amount', () => {
  it('accepts a rule with its amount set, by type', () => {
    expect(ruleConfigProblem('EQUAL_PER_FLAT', { amount: 2500 })).toBeNull();
    expect(ruleConfigProblem('EQUAL_PER_FLAT', { amount: '2500' })).toBeNull();
    expect(ruleConfigProblem('FIXED_CUSTOM', { amount: 10 })).toBeNull();
    expect(ruleConfigProblem('AREA_BASED', { ratePerSqft: 2.5 })).toBeNull();
    expect(ruleConfigProblem('PER_PERSON', { ratePerPerson: 300 })).toBeNull();
    expect(ruleConfigProblem('HYBRID', { baseAmount: 1000 })).toBeNull();
    expect(ruleConfigProblem('HYBRID', { areaRate: 1 })).toBeNull();
    expect(ruleConfigProblem('PERCENTAGE_BASED', { percentage: 5, baseAmount: 1000 })).toBeNull();
  });

  it('refuses a rule that would bill nothing — no amount, zero, negative, or not a number', () => {
    for (const config of [undefined, null, {}, { amount: 0 }, { amount: -5 }, { amount: 'lots' }]) {
      expect(ruleConfigProblem('EQUAL_PER_FLAT', config as any)).toMatch(/amount/i);
    }
    expect(ruleConfigProblem('AREA_BASED', {})).toMatch(/square foot/);
    expect(ruleConfigProblem('PER_PERSON', {})).toMatch(/per person/);
    expect(ruleConfigProblem('PERCENTAGE_BASED', { percentage: 5 })).toMatch(/percentage/);
  });

  it('points water at Water Billing, and refuses types that cannot charge yet', () => {
    expect(ruleConfigProblem('WATER_USAGE_BASED', { amount: 5 })).toMatch(/Water Billing/);
    expect(ruleConfigProblem('CUSTOM_FORMULA', { amount: 5 })).toMatch(/cannot be used/);
  });
});

describe('charge type', () => {
  it('reads a known type from the config', () => {
    expect(chargeTypeOf({ chargeType: 'CORPUS' })).toBe('CORPUS');
    expect(chargeTypeOf({ chargeType: 'MAINTENANCE', amount: 1 })).toBe('MAINTENANCE');
  });

  it('ignores anything else', () => {
    expect(chargeTypeOf({ chargeType: 'ELECTRICITY' })).toBeUndefined();
    expect(chargeTypeOf({})).toBeUndefined();
    expect(chargeTypeOf(null)).toBeUndefined();
  });
});
