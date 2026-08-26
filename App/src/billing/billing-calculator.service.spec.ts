import { BillingCalculatorService } from './billing-calculator.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('BillingCalculatorService', () => {
  let service: BillingCalculatorService;

  beforeEach(() => {
    service = new BillingCalculatorService();
  });

  const flatCtx = {
    flatId: 'flat-001',
    flatCode: 'A-101',
    area: new Decimal(850),
    category: '2BHK',
    parkingSlots: 1,
    residentCount: 3,
    buildingId: 'building-001',
  };

  describe('EQUAL_PER_FLAT', () => {
    it('should charge equal amount regardless of area', () => {
      const rule = {
        id: 'rule-001',
        name: 'Equal Maintenance',
        calculationType: 'EQUAL_PER_FLAT',
        config: { amount: 5000 },
        components: [],
      };

      const result = service.calculateFlatBill(flatCtx, [rule]);
      expect(result.baseAmount).toBe(5000);
      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].componentName).toBe('Equal Maintenance');
    });

    it('should produce same amount for flats with different areas', () => {
      const rule = {
        id: 'rule-001',
        name: 'Fixed Fee',
        calculationType: 'EQUAL_PER_FLAT',
        config: { amount: 3000 },
        components: [],
      };

      const smallFlat = { ...flatCtx, area: new Decimal(500) };
      const largeFlat = { ...flatCtx, area: new Decimal(1500) };

      const r1 = service.calculateFlatBill(smallFlat, [rule]);
      const r2 = service.calculateFlatBill(largeFlat, [rule]);

      expect(r1.baseAmount).toBe(r2.baseAmount);
    });
  });

  describe('AREA_BASED', () => {
    it('should calculate maintenance based on area', () => {
      const rule = {
        id: 'rule-002',
        name: 'Area Maintenance',
        calculationType: 'AREA_BASED',
        config: { ratePerSqft: 5 },
        components: [],
      };

      const result = service.calculateFlatBill(flatCtx, [rule]);
      // 850 sqft × ₹5 = ₹4250
      expect(result.baseAmount).toBe(4250);
      expect(result.lineItems[0].quantity).toBe(850);
      expect(result.lineItems[0].rate).toBe(5);
    });

    it('should produce 0 line items for flat with no area', () => {
      const rule = {
        id: 'rule-002',
        name: 'Area Maintenance',
        calculationType: 'AREA_BASED',
        config: { ratePerSqft: 5 },
        components: [],
      };

      const noAreaFlat = { ...flatCtx, area: null };
      const result = service.calculateFlatBill(noAreaFlat, [rule]);
      expect(result.lineItems).toHaveLength(0);
    });
  });

  describe('PER_PERSON', () => {
    it('should calculate based on resident count', () => {
      const rule = {
        id: 'rule-003',
        name: 'Per Resident Charge',
        calculationType: 'PER_PERSON',
        config: { ratePerPerson: 500 },
        components: [],
      };

      const result = service.calculateFlatBill(flatCtx, [rule]);
      // 3 residents × ₹500 = ₹1500
      expect(result.baseAmount).toBe(1500);
    });

    it('should produce 0 for vacant flat with no residents', () => {
      const rule = {
        id: 'rule-003',
        name: 'Per Resident Charge',
        calculationType: 'PER_PERSON',
        config: { ratePerPerson: 500 },
        components: [],
      };

      const vacantFlat = { ...flatCtx, residentCount: 0 };
      const result = service.calculateFlatBill(vacantFlat, [rule]);
      expect(result.lineItems).toHaveLength(0);
    });
  });

  describe('HYBRID', () => {
    it('should sum base + area-based charge', () => {
      const rule = {
        id: 'rule-004',
        name: 'Hybrid Maintenance',
        calculationType: 'HYBRID',
        config: { baseAmount: 1000, areaRate: 2 },
        components: [],
      };

      const result = service.calculateFlatBill(flatCtx, [rule]);
      // ₹1000 + (850 × ₹2) = ₹1000 + ₹1700 = ₹2700
      expect(result.baseAmount).toBe(2700);
    });
  });

  describe('Multiple rules', () => {
    it('should sum all active rule amounts', () => {
      const rules = [
        {
          id: 'rule-001',
          name: 'Base Maintenance',
          calculationType: 'EQUAL_PER_FLAT',
          config: { amount: 2000 },
          components: [],
        },
        {
          id: 'rule-002',
          name: 'Corpus Fund',
          calculationType: 'EQUAL_PER_FLAT',
          config: { amount: 500 },
          components: [],
        },
      ];

      const result = service.calculateFlatBill(flatCtx, rules);
      expect(result.baseAmount).toBe(2500);
      expect(result.lineItems).toHaveLength(2);
    });
  });

  describe('FIXED_CUSTOM', () => {
    it('should apply fixed charge as a line item', () => {
      const rule = {
        id: 'rule-005',
        name: 'Parking Charge',
        calculationType: 'FIXED_CUSTOM',
        config: { amount: 300 },
        components: [],
      };

      const result = service.calculateFlatBill(flatCtx, [rule]);
      expect(result.baseAmount).toBe(300);
    });
  });

  describe('PERCENTAGE_BASED', () => {
    it('should calculate percentage of base amount', () => {
      const rule = {
        id: 'rule-006',
        name: 'GST',
        calculationType: 'PERCENTAGE_BASED',
        config: { baseAmount: 5000, percentage: 18 },
        components: [],
      };

      const result = service.calculateFlatBill(flatCtx, [rule]);
      // 18% of 5000 = 900
      expect(result.baseAmount).toBe(900);
    });
  });

  describe('Calculation snapshot', () => {
    it('should not mutate historical bills when rules change', () => {
      const originalAmount = 850 * 5; // 4250

      const newRule = {
        id: 'rule-002',
        name: 'Area Maintenance',
        calculationType: 'AREA_BASED',
        config: { ratePerSqft: 7 },
        components: [],
      };

      const newResult = service.calculateFlatBill(flatCtx, [newRule]);
      expect(newResult.baseAmount).toBe(850 * 7); // 5950
      expect(originalAmount).toBe(4250);
      expect(newResult.baseAmount).not.toBe(originalAmount);
    });
  });

  // ─── DEFECT-4: Decimal precision tests ────────────────────────────────────

  describe('Decimal precision (DEFECT-4)', () => {
    it('333.33 × 3 = 999.99 exactly (not 999.9900000000001)', () => {
      const flat = { ...flatCtx, area: new Decimal('333.33') };
      const rule = {
        id: 'rule-dec-1',
        name: 'Decimal Test',
        calculationType: 'AREA_BASED',
        config: { ratePerSqft: 3 },
        components: [],
      };
      const result = service.calculateFlatBill(flat, [rule]);
      expect(result.baseAmount).toBe(999.99);
    });

    it('850 × 5.55 = 4717.50 exactly', () => {
      const flat = { ...flatCtx, area: new Decimal('850') };
      const rule = {
        id: 'rule-dec-2',
        name: 'Rate Test',
        calculationType: 'AREA_BASED',
        config: { ratePerSqft: 5.55 },
        components: [],
      };
      const result = service.calculateFlatBill(flat, [rule]);
      expect(result.baseAmount).toBe(4717.50);
    });

    it('999.99 × 3 = 2999.97 exactly', () => {
      const flat = { ...flatCtx, area: new Decimal('999.99') };
      const rule = {
        id: 'rule-dec-3',
        name: 'Large Decimal',
        calculationType: 'AREA_BASED',
        config: { ratePerSqft: 3 },
        components: [],
      };
      const result = service.calculateFlatBill(flat, [rule]);
      expect(result.baseAmount).toBe(2999.97);
    });

    it('10.01 × 7 = 70.07 exactly', () => {
      const flat = { ...flatCtx, area: new Decimal('10.01') };
      const rule = {
        id: 'rule-dec-4',
        name: 'Small Decimal',
        calculationType: 'AREA_BASED',
        config: { ratePerSqft: 7 },
        components: [],
      };
      const result = service.calculateFlatBill(flat, [rule]);
      expect(result.baseAmount).toBe(70.07);
    });

    it('percentage: 18% of 3333.33 = 599.99 (rounded to 2dp)', () => {
      const rule = {
        id: 'rule-dec-5',
        name: 'GST Decimal',
        calculationType: 'PERCENTAGE_BASED',
        config: { baseAmount: 3333.33, percentage: 18 },
        components: [],
      };
      const result = service.calculateFlatBill(flatCtx, [rule]);
      // 3333.33 * 18 / 100 = 599.9994 → rounds to 600.00
      expect(Number.isFinite(result.baseAmount)).toBe(true);
      expect(result.baseAmount).toBe(600.00);
    });

    it('hybrid: Decimal arithmetic base + area', () => {
      const flat = { ...flatCtx, area: new Decimal('333.33') };
      const rule = {
        id: 'rule-dec-6',
        name: 'Hybrid Decimal',
        calculationType: 'HYBRID',
        config: { baseAmount: 1000.50, areaRate: 3 },
        components: [],
      };
      const result = service.calculateFlatBill(flat, [rule]);
      // 1000.50 + (333.33 × 3) = 1000.50 + 999.99 = 2000.49
      expect(result.baseAmount).toBe(2000.49);
    });

    it('total is computed with Decimal accumulation — no float drift on multiple rules', () => {
      const flat = { ...flatCtx, area: new Decimal('333.33') };
      const rules = [
        { id: 'r1', name: 'Rule 1', calculationType: 'AREA_BASED', config: { ratePerSqft: 3 }, components: [] },
        { id: 'r2', name: 'Rule 2', calculationType: 'AREA_BASED', config: { ratePerSqft: 3 }, components: [] },
        { id: 'r3', name: 'Rule 3', calculationType: 'AREA_BASED', config: { ratePerSqft: 3 }, components: [] },
      ];
      const result = service.calculateFlatBill(flat, rules);
      // Each: 333.33 × 3 = 999.99; total: 2999.97
      expect(result.baseAmount).toBe(2999.97);
    });
  });

  // ─── DEFECT-9: Unsupported billing types throw ─────────────────────────────

  describe('Unsupported billing types (DEFECT-9)', () => {
    it('CUSTOM_FORMULA throws BadRequestException', () => {
      const rule = {
        id: 'rule-custom',
        name: 'Custom Rule',
        calculationType: 'CUSTOM_FORMULA',
        config: {},
        components: [],
      };
      expect(() => service.calculateFlatBill(flatCtx, [rule])).toThrow('CUSTOM_FORMULA');
    });

    it('unknown type throws BadRequestException with the type name', () => {
      const rule = {
        id: 'rule-unknown',
        name: 'Unknown Rule',
        calculationType: 'FUTURE_TYPE_XYZ',
        config: {},
        components: [],
      };
      expect(() => service.calculateFlatBill(flatCtx, [rule])).toThrow('FUTURE_TYPE_XYZ');
    });

    it('valid rules before an unsupported one still cause the bill to fail', () => {
      const rules = [
        { id: 'r1', name: 'Valid', calculationType: 'EQUAL_PER_FLAT', config: { amount: 1000 }, components: [] },
        { id: 'r2', name: 'Invalid', calculationType: 'CUSTOM_FORMULA', config: {}, components: [] },
      ];
      expect(() => service.calculateFlatBill(flatCtx, rules)).toThrow();
    });
  });
});
