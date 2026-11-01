import {
  DEFAULT_LIMIT_FORM, chargeFor, describeLimit, formFromSaved, limitFromForm, validateLimitForm, type UsageLimit, type UsageLimitForm,
} from '@/utils/waterUsageLimit';

const pct = (value: number, limitUnits = 20): UsageLimit => ({ limitUnits, mode: 'PERCENT', value });
const form = (over: Partial<UsageLimitForm> = {}): UsageLimitForm => ({ enabled: true, limitUnits: '20', mode: 'PERCENT', value: '25', ...over });

describe('chargeFor', () => {
  it('is units × rate with no limit', () => {
    expect(chargeFor(26, 50, null)).toEqual({ base: 1300, excessUnits: 0, excess: 0, total: 1300 });
  });

  it('leaves a flat within the limit, or exactly on it, unchanged', () => {
    expect(chargeFor(12, 50, pct(50)).total).toBe(600);
    expect(chargeFor(20, 50, pct(50)).total).toBe(1000);
    expect(chargeFor(20, 50, pct(50)).excess).toBe(0);
  });

  it('charges a percentage more on the units above the limit only', () => {
    // 20 at ₹50 + 6 at ₹62.50
    const c = chargeFor(26, 50, pct(25));
    expect(c.excessUnits).toBe(6);
    expect(c.excess).toBe(75);
    expect(c.total).toBe(1375);
  });

  it('adds rupees per unit above the limit', () => {
    expect(chargeFor(26, 50, { limitUnits: 20, mode: 'PER_UNIT', value: 10 }).total).toBe(1360);
  });

  it('adds a one-time fee once the limit is crossed', () => {
    const fee: UsageLimit = { limitUnits: 20, mode: 'ONE_TIME', value: 500 };
    expect(chargeFor(21, 50, fee).total).toBe(1550);
    expect(chargeFor(60, 50, fee).total).toBe(3500);
    expect(chargeFor(20, 50, fee).total).toBe(1000);
  });

  it('rounds to the paisa', () => {
    expect(chargeFor(23.333, 37.7777, pct(15)).total.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});

describe('the form', () => {
  it('starts switched off', () => {
    expect(DEFAULT_LIMIT_FORM.enabled).toBe(false);
    expect(limitFromForm(DEFAULT_LIMIT_FORM)).toBeNull();
  });

  it('is filled from a saved rule, switched on', () => {
    expect(formFromSaved({ limitUnits: 15, mode: 'PER_UNIT', value: 12.5 })).toEqual({ enabled: true, limitUnits: '15', mode: 'PER_UNIT', value: '12.5' });
    expect(formFromSaved(null)).toEqual(DEFAULT_LIMIT_FORM);
    expect(formFromSaved(undefined)).toEqual(DEFAULT_LIMIT_FORM);
  });

  it('turns into the rule to send, or nothing when off or not valid', () => {
    expect(limitFromForm(form())).toEqual(pct(25));
    expect(limitFromForm(form({ enabled: false }))).toBeNull();
    expect(limitFromForm(form({ limitUnits: '' }))).toBeNull();
  });

  it('is not checked while it is off', () => {
    expect(validateLimitForm(form({ enabled: false, limitUnits: '', value: '' }))).toBeNull();
  });

  it('refuses what the server would refuse', () => {
    expect(validateLimitForm(form({ limitUnits: '' }))).toMatch(/how many units/);
    expect(validateLimitForm(form({ limitUnits: '0' }))).toMatch(/how many units/);
    expect(validateLimitForm(form({ limitUnits: '1000000' }))).toMatch(/too large/);
    expect(validateLimitForm(form({ value: '' }))).toMatch(/extra charge/);
    expect(validateLimitForm(form({ value: '-3' }))).toMatch(/extra charge/);
    expect(validateLimitForm(form({ value: '1.234', mode: 'PER_UNIT' }))).toMatch(/two decimal/);
    expect(validateLimitForm(form({ value: '1500' }))).toMatch(/1000%/);
    expect(validateLimitForm(form({ value: '1500', mode: 'ONE_TIME' }))).toBeNull();
    expect(validateLimitForm(form())).toBeNull();
  });
});

describe('describeLimit', () => {
  it('works the real rate into the sentence', () => {
    expect(describeLimit(pct(25), 100)).toBe("Each flat's first 20 KL are charged at the normal rate. Each KL above that costs 25% more (₹100 becomes ₹125 a KL).");
    expect(describeLimit({ limitUnits: 20, mode: 'PER_UNIT', value: 10 }, 100)).toContain('₹100 becomes ₹110 a KL');
    expect(describeLimit({ limitUnits: 20, mode: 'ONE_TIME', value: 500 })).toContain('one-time fee of ₹500');
  });

  it('leaves the rate out until there is one', () => {
    expect(describeLimit(pct(25))).toBe("Each flat's first 20 KL are charged at the normal rate. Each KL above that costs 25% more.");
  });
});
