import { buildRulePayload, describeRule, lastDayAfter, RuleForm } from '@/utils/billingRules';

const corpus: RuleForm = { kind: 'CORPUS', name: 'Corpus fund', basis: 'EQUAL_PER_FLAT', amount: '900', installments: '3', startMonth: '2042-01', effectiveFrom: '', effectiveTo: '' };
const regular: RuleForm = { kind: 'MAINTENANCE', name: 'Monthly maintenance', basis: 'EQUAL_PER_FLAT', amount: '2500', installments: '1', startMonth: '', effectiveFrom: '2042-01-01', effectiveTo: '' };
const ok = (f: RuleForm) => (buildRulePayload(f) as { payload: any }).payload;
const err = (f: RuleForm) => (buildRulePayload(f) as { error: string }).error;

describe('regular maintenance', () => {
  it('is the amount once, for every flat, from the first day', () => {
    expect(ok(regular)).toEqual({
      name: 'Monthly maintenance', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2042-01-01T00:00:00.000Z', effectiveTo: undefined,
      priority: 1, config: { amount: 2500, chargeType: 'MAINTENANCE' },
    });
  });

  it('puts a per-square-foot or per-resident rate under the key the server reads', () => {
    expect(ok({ ...regular, basis: 'AREA_BASED', amount: '2.5' }).config).toEqual({ ratePerSqft: 2.5, chargeType: 'MAINTENANCE' });
    expect(ok({ ...regular, basis: 'PER_PERSON', amount: '300' }).config).toEqual({ ratePerPerson: 300, chargeType: 'MAINTENANCE' });
  });

  it('keeps an end date when one is given', () => {
    expect(ok({ ...regular, effectiveTo: '2042-12-31' }).effectiveTo).toBe('2042-12-31T00:00:00.000Z');
  });

  it('refuses a missing or non-positive amount, and an end before the start', () => {
    expect(err({ ...regular, amount: '' })).toMatch(/amount/);
    expect(err({ ...regular, amount: '0' })).toMatch(/amount/);
    expect(err({ ...regular, amount: '-3' })).toMatch(/amount/);
    expect(err({ ...regular, basis: 'AREA_BASED', amount: '' })).toMatch(/rate/);
    expect(err({ ...regular, effectiveTo: '2041-12-31' })).toMatch(/before/);
    expect(err({ ...regular, name: '  ' })).toMatch(/name/);
  });
});

describe('a corpus', () => {
  it('splits the total into monthly instalments and runs for exactly those months', () => {
    const p = ok(corpus);
    expect(p.config).toEqual({ amount: 300, chargeType: 'CORPUS', installments: 3, total: 900 });
    expect(p.effectiveFrom).toBe('2042-01-01T00:00:00.000Z');
    expect(p.effectiveTo).toBe('2042-03-31T00:00:00.000Z');
  });

  it('can be collected in one go — a single month', () => {
    const p = ok({ ...corpus, installments: '1' });
    expect(p.config.amount).toBe(900);
    expect(p.effectiveTo).toBe('2042-01-31T00:00:00.000Z');
  });

  it('rounds an instalment to paise', () => {
    expect(ok({ ...corpus, amount: '1000', installments: '3' }).config.amount).toBe(333.33);
  });

  it('ends on the right last day across years and leap years', () => {
    expect(lastDayAfter('2042-11', 3)).toBe('2043-01-31');
    expect(lastDayAfter('2024-01', 2)).toBe('2024-02-29');
    expect(lastDayAfter('2042-02', 1)).toBe('2042-02-28');
  });

  it('refuses silly instalment counts and a missing start month', () => {
    expect(err({ ...corpus, installments: '0' })).toMatch(/between 1 and 60/);
    expect(err({ ...corpus, installments: '61' })).toMatch(/between 1 and 60/);
    expect(err({ ...corpus, startMonth: '' })).toMatch(/month/);
  });
});

describe('describing a saved rule', () => {
  it('says what it charges', () => {
    expect(describeRule({ calculationType: 'EQUAL_PER_FLAT', config: { amount: 2500, chargeType: 'MAINTENANCE' } })).toBe('₹2,500 per flat · Regular maintenance');
    expect(describeRule({ calculationType: 'AREA_BASED', config: { ratePerSqft: 2.5 } })).toBe('₹2.5 per sq ft');
    expect(describeRule({ calculationType: 'EQUAL_PER_FLAT', config: ok(corpus).config })).toBe('₹300 per flat a month for 3 months · Corpus fund');
  });

  it('warns plainly when a rule charges nothing — the old rules made on screen', () => {
    expect(describeRule({ calculationType: 'EQUAL_PER_FLAT', config: {} })).toMatch(/charges nothing/);
    expect(describeRule({ calculationType: 'EQUAL_PER_FLAT', config: null })).toMatch(/charges nothing/);
    expect(describeRule({ calculationType: 'HYBRID', config: { baseAmount: 5 } })).toMatch(/charges nothing/);
  });
});
