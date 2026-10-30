import { ruleDetailRows } from '@/utils/billingRuleDetails';

const rows = (r: { label: string; value: string }[]) => Object.fromEntries(r.map((x) => [x.label, x.value]));

describe('what is inside a saved rule', () => {
  it('lists the amount, kind, dates and status of a simple rule', () => {
    const d = ruleDetailRows({
      name: 'Monthly maintenance', calculationType: 'EQUAL_PER_FLAT', isActive: true, effectiveFrom: '2026-04-01T00:00:00.000Z', effectiveTo: null, priority: 1,
      config: { amount: 2500, chargeType: 'MAINTENANCE' },
    });
    expect(rows(d.summary)).toMatchObject({
      Status: 'Active', Charges: '₹2,500 per flat · Regular maintenance', 'Worked out': 'Same amount for every flat',
      'Amount per flat': '₹2,500', 'Kind of charge': 'Regular maintenance', 'Applies until': 'Until changed', Priority: '1',
    });
    expect(d.components).toEqual([]);
  });

  it('spells out a corpus, including the instalments and the total', () => {
    const d = ruleDetailRows({
      calculationType: 'EQUAL_PER_FLAT', config: { amount: 1000, chargeType: 'CORPUS', installments: 6, total: 6000 },
      effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: '2027-03-31T00:00:00.000Z',
    });
    expect(rows(d.summary)).toMatchObject({ 'Collected over (months)': '6', 'Total to collect': '₹6,000', 'Kind of charge': 'Corpus fund' });
    expect(rows(d.summary)['Applies until']).toMatch(/2027/);
  });

  it('shows each component with its amount or rate — the case that showed nothing before', () => {
    const d = ruleDetailRows({
      name: 'Standard', calculationType: 'AREA_BASED', isActive: true,
      components: [
        { name: 'Sinking fund', componentType: 'MAINTENANCE', calculationType: 'AREA_BASED', rate: '2.5000', amount: null, config: {} },
        { name: 'Lift', componentType: 'CHARGE', calculationType: 'EQUAL_PER_FLAT', amount: '300.00' },
      ],
    });
    expect(d.components.map((c) => c.title)).toEqual(['Sinking fund', 'Lift']);
    expect(rows(d.components[0].rows)).toMatchObject({ Rate: '₹2.5', 'Worked out': 'Per square foot of the flat' });
    expect(rows(d.components[1].rows)).toMatchObject({ Amount: '₹300' });
  });

  it('says plainly when a rule is switched off or charges nothing', () => {
    expect(rows(ruleDetailRows({ calculationType: 'EQUAL_PER_FLAT', isActive: false, config: {} }).summary)).toMatchObject({
      Status: 'Inactive — not used for new bills',
      Charges: expect.stringMatching(/charges nothing/),
    });
  });

  it('shows a setting it does not know by its own name rather than hiding it', () => {
    expect(rows(ruleDetailRows({ calculationType: 'HYBRID', config: { someNewKey: 7 } }).summary)).toMatchObject({ someNewKey: '7' });
  });
});
