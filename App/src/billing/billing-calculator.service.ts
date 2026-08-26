import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export interface BillingRuleWithComponents {
  id: string;
  name: string;
  calculationType: string;
  config: Prisma.JsonValue;
  components: {
    id: string;
    name: string;
    componentType: string;
    calculationType: string;
    amount: Decimal | null;
    rate: Decimal | null;
    config: Prisma.JsonValue;
  }[];
}

export interface FlatBillingContext {
  flatId: string;
  flatCode: string;
  area: Decimal | null;
  category: string | null;
  parkingSlots: number;
  residentCount: number;
  buildingId: string;
}

export interface BillLineItemResult {
  componentName: string;
  componentType: string;
  description?: string;
  quantity?: number;
  rate?: number;
  amount: number;
  calculationNote?: string;
  billingRuleId?: string;
}

export interface FlatBillResult {
  flatId: string;
  flatCode: string;
  baseAmount: number;
  lineItems: BillLineItemResult[];
}

@Injectable()
export class BillingCalculatorService {
  calculateFlatBill(
    flat: FlatBillingContext,
    rules: BillingRuleWithComponents[],
  ): FlatBillResult {
    const lineItems: BillLineItemResult[] = [];
    let total = new Decimal(0);

    for (const rule of rules) {
      const items = this.applyRule(flat, rule);
      lineItems.push(...items);
      for (const item of items) {
        total = total.plus(new Decimal(item.amount.toString()));
      }
    }

    return {
      flatId: flat.flatId,
      flatCode: flat.flatCode,
      baseAmount: total.toNumber(),
      lineItems,
    };
  }

  private applyRule(
    flat: FlatBillingContext,
    rule: BillingRuleWithComponents,
  ): BillLineItemResult[] {
    if (rule.components.length > 0) {
      const items: BillLineItemResult[] = [];
      for (const component of rule.components) {
        const item = this.calculateComponent(flat, component, rule.id);
        if (item) items.push(item);
      }
      return items;
    }

    const item = this.calculateByType(flat, rule.calculationType, rule.config, rule.name, rule.id);
    return item ? [item] : [];
  }

  private calculateComponent(
    flat: FlatBillingContext,
    component: BillingRuleWithComponents['components'][0],
    ruleId: string,
  ): BillLineItemResult | null {
    return this.calculateByType(
      flat,
      component.calculationType,
      component.config,
      component.name,
      ruleId,
      component.amount ?? undefined,
      component.rate ?? undefined,
      component.componentType,
    );
  }

  private calculateByType(
    flat: FlatBillingContext,
    calculationType: string,
    config: Prisma.JsonValue,
    name: string,
    ruleId: string,
    fixedAmountDecimal?: Decimal,
    rateDecimal?: Decimal,
    componentType?: string,
  ): BillLineItemResult | null {
    const cfg = (config as Record<string, unknown>) ?? {};

    // DEFECT-4: Use Decimal for all financial arithmetic to avoid float precision errors
    switch (calculationType) {
      case 'EQUAL_PER_FLAT': {
        const amount = fixedAmountDecimal
          ? fixedAmountDecimal
          : new Decimal((cfg['amount'] as number | string | undefined) ?? 0);
        if (amount.isZero()) return null;
        return {
          componentName: name,
          componentType: componentType ?? 'MAINTENANCE',
          amount: this.round(amount),
          calculationNote: `Fixed per flat: ₹${amount.toFixed(2)}`,
          billingRuleId: ruleId,
        };
      }

      case 'AREA_BASED': {
        const flatArea = flat.area ?? new Decimal(0);
        if (flatArea.isZero()) return null;
        const rate = rateDecimal
          ? rateDecimal
          : new Decimal((cfg['ratePerSqft'] as number | string | undefined) ?? 0);
        const amount = flatArea.mul(rate);
        return {
          componentName: name,
          componentType: componentType ?? 'MAINTENANCE',
          quantity: flatArea.toNumber(),
          rate: rate.toNumber(),
          amount: this.round(amount),
          calculationNote: `${flatArea.toFixed(2)} sqft × ₹${rate.toFixed(2)}/sqft`,
          billingRuleId: ruleId,
        };
      }

      case 'PER_PERSON': {
        const residents = flat.residentCount;
        if (residents === 0) return null;
        const rate = rateDecimal
          ? rateDecimal
          : new Decimal((cfg['ratePerPerson'] as number | string | undefined) ?? 0);
        const amount = new Decimal(residents).mul(rate);
        return {
          componentName: name,
          componentType: componentType ?? 'MAINTENANCE',
          quantity: residents,
          rate: rate.toNumber(),
          amount: this.round(amount),
          calculationNote: `${residents} residents × ₹${rate.toFixed(2)}/person`,
          billingRuleId: ruleId,
        };
      }

      case 'FIXED_CUSTOM': {
        const amount = fixedAmountDecimal
          ? fixedAmountDecimal
          : new Decimal((cfg['amount'] as number | string | undefined) ?? 0);
        if (amount.isZero()) return null;
        return {
          componentName: name,
          componentType: componentType ?? 'CHARGE',
          amount: this.round(amount),
          calculationNote: `Fixed charge: ₹${amount.toFixed(2)}`,
          billingRuleId: ruleId,
        };
      }

      case 'HYBRID': {
        const base = new Decimal((cfg['baseAmount'] as number | string | undefined) ?? 0);
        const areaRate = new Decimal((cfg['areaRate'] as number | string | undefined) ?? 0);
        const flatArea = flat.area ?? new Decimal(0);
        const amount = base.plus(flatArea.mul(areaRate));
        return {
          componentName: name,
          componentType: componentType ?? 'MAINTENANCE',
          amount: this.round(amount),
          calculationNote: `Base ₹${base.toFixed(2)} + (${flatArea.toFixed(2)} sqft × ₹${areaRate.toFixed(2)})`,
          billingRuleId: ruleId,
        };
      }

      case 'PERCENTAGE_BASED': {
        const baseAmount = new Decimal((cfg['baseAmount'] as number | string | undefined) ?? 0);
        const percentage = new Decimal((cfg['percentage'] as number | string | undefined) ?? 0);
        const amount = baseAmount.mul(percentage).div(new Decimal(100));
        return {
          componentName: name,
          componentType: componentType ?? 'CHARGE',
          amount: this.round(amount),
          calculationNote: `${percentage.toFixed(2)}% of ₹${baseAmount.toFixed(2)}`,
          billingRuleId: ruleId,
        };
      }

      case 'CUSTOM_FORMULA':
        // DEFECT-9: Unsupported type must not silently produce zero — fail fast
        throw new BadRequestException(
          `Billing rule "${name}" uses CUSTOM_FORMULA which is not yet supported. ` +
          `Remove or reconfigure this rule before generating bills.`,
        );

      default:
        // DEFECT-9: Any other unknown type must also fail fast
        throw new BadRequestException(
          `Billing rule "${name}" uses unsupported calculation type "${calculationType}". ` +
          `Supported types: EQUAL_PER_FLAT, AREA_BASED, PER_PERSON, FIXED_CUSTOM, HYBRID, PERCENTAGE_BASED.`,
        );
    }
  }

  private round(amount: Decimal): number {
    return amount.toDecimalPlaces(2).toNumber();
  }
}
