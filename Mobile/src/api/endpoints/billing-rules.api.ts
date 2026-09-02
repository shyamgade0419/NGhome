import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

/**
 * CalculationType mirrors the Prisma enum exactly. The DTO validates with
 * @IsEnum, so any value outside this union is rejected with a 400.
 */
export type CalculationType =
  | 'EQUAL_PER_FLAT'
  | 'AREA_BASED'
  | 'PER_PERSON'
  | 'HYBRID'
  | 'FIXED_CUSTOM'
  | 'PERCENTAGE_BASED'
  | 'WATER_USAGE_BASED'
  | 'CUSTOM_FORMULA';

export const CALCULATION_TYPES: Array<{ value: CalculationType; label: string }> = [
  { value: 'EQUAL_PER_FLAT', label: 'Equal per flat' },
  { value: 'AREA_BASED', label: 'Area based (per sq ft)' },
  { value: 'PER_PERSON', label: 'Per person' },
  { value: 'WATER_USAGE_BASED', label: 'Water usage based' },
  { value: 'PERCENTAGE_BASED', label: 'Percentage based' },
  { value: 'HYBRID', label: 'Hybrid' },
  { value: 'FIXED_CUSTOM', label: 'Fixed custom' },
  { value: 'CUSTOM_FORMULA', label: 'Custom formula' },
];

export interface BillingRule {
  id: string;
  name: string;
  description: string | null;
  calculationType: CalculationType;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  components?: Array<{ id: string; name: string; componentType: string; amount?: string | null }>;
}

function unwrap<T>(data: any): T {
  return (data?.data ?? data) as T;
}

export const billingRulesApi = {
  list: async () => {
    const { data } = await apiClient.get('/billing-rules');
    return unwrap<BillingRule[]>(data);
  },

  active: async () => {
    const { data } = await apiClient.get('/billing-rules/active');
    return unwrap<BillingRule[]>(data);
  },

  create: async (payload: {
    name: string;
    description?: string;
    calculationType: CalculationType;
    effectiveFrom: string;
    effectiveTo?: string;
    priority?: number;
  }) => {
    const { data } = await apiClient.post<ApiResponse<BillingRule>>('/billing-rules', payload);
    return data.data ?? (data as unknown as BillingRule);
  },

  toggle: async (id: string, isActive: boolean): Promise<void> => {
    await apiClient.patch(`/billing-rules/${id}/toggle`, { isActive });
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/billing-rules/${id}`);
  },
};
