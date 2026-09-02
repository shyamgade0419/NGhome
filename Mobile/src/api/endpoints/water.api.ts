import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

/**
 * SOCIETY_ALLOCATION is deliberately excluded from the manually-created
 * models below — allocatePeriodCosts() auto-creates and reuses its own
 * SOCIETY_ALLOCATION config, so exposing it here would just create
 * confusing duplicate rows. CUSTOM isn't in this list either: nothing in
 * the billing engine's calculateWaterAmount() switch handles it (falls
 * through to its `default` case), so it has no real effect today.
 */
export type ConfigurableWaterBillingModel =
  | 'PER_LITRE'
  | 'PER_KL'
  | 'FIXED_CHARGE'
  | 'FIXED_PLUS_USAGE'
  | 'SLAB_BASED';

export type WaterBillingModel = ConfigurableWaterBillingModel | 'SOCIETY_ALLOCATION' | 'CUSTOM';

export interface WaterSlab {
  upTo: number;
  rate: number;
}

/**
 * The `config` JSON shape read by WaterService.calculateWaterAmount() —
 * verified directly against that switch statement, not guessed:
 *   PER_LITRE        → { ratePerLitre }
 *   PER_KL           → { ratePerKL }
 *   FIXED_CHARGE     → { fixedAmount }
 *   FIXED_PLUS_USAGE → { fixedAmount, ratePerKL, minimumKL }
 *   SLAB_BASED       → { slabs: [{ upTo, rate }, ...] }
 */
export interface WaterConfigPayload {
  name: string;
  billingModel: ConfigurableWaterBillingModel;
  effectiveFrom: string;
  effectiveTo?: string;
  config: {
    ratePerLitre?: number;
    ratePerKL?: number;
    fixedAmount?: number;
    minimumKL?: number;
    slabs?: WaterSlab[];
  };
}

export interface WaterBillingConfig {
  id: string;
  name: string;
  billingModel: WaterBillingModel;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface FlatReading {
  flatId: string;
  openingReading: number;
  closingReading: number;
  notes?: string;
}

export interface AllocateCostsPayload {
  readingDate: string;
  municipalWaterBill: number;
  tankerCost: number;
  commonElectricityBill: number;
  electricityWaterPercent: number;
  readings: FlatReading[];
}

export interface AllocationResult {
  costBreakdown: {
    municipalWaterBill: number;
    tankerCost: number;
    commonElectricityBill: number;
    electricityWaterPercent: number;
    electricityWaterCost: number;
    totalWaterCost: number;
  };
  totalUnits: number;
  ratePerUnit: number;
  flatCount: number;
  flatReadings: Array<{
    flatId: string;
    flatCode: string;
    openingReading: number;
    closingReading: number;
    consumption: number;
    ratePerUnit: number;
    charge: number;
  }>;
}

/** A stored reading as returned by GET /water/readings. */
export interface StoredReading {
  id: string;
  flatId: string;
  billingPeriodId: string | null;
  readingDate: string;
  openingReading: string;
  closingReading: string;
  consumption: string;
  unit: string;
  flat?: { id: string; flatCode: string } | null;
}

export const waterApi = {
  /**
   * Readings, newest first. Passing no periodId returns the whole history,
   * which is how the entry screen finds each flat's last closing reading to
   * carry forward as this month's opening.
   */
  getReadings: async (params?: { periodId?: string; flatId?: string }) => {
    const { data } = await apiClient.get('/water/readings', { params });
    return ((data as any)?.data ?? data ?? []) as StoredReading[];
  },

  allocatePeriodCosts: async (periodId: string, payload: AllocateCostsPayload) => {
    const { data } = await apiClient.post<ApiResponse<AllocationResult>>(
      `/water/periods/${periodId}/allocate`,
      payload,
    );
    return data.data;
  },

  getPeriodSummary: async (periodId: string) => {
    const { data } = await apiClient.get<ApiResponse<AllocationResult>>(
      `/water/periods/${periodId}/summary`,
    );
    return data.data;
  },

  // Config CRUD — the backend only ever exposes create + list (no update or
  // delete route exists for /water/configs), which actually matches the
  // effectiveFrom/effectiveTo fields' intent: a rate change is a new config
  // effective from a date, not an edit of the old one.
  listConfigs: async (): Promise<WaterBillingConfig[]> => {
    const { data } = await apiClient.get('/water/configs');
    return ((data as any)?.data ?? data ?? []) as WaterBillingConfig[];
  },

  createConfig: async (payload: WaterConfigPayload): Promise<WaterBillingConfig> => {
    const { data } = await apiClient.post<ApiResponse<WaterBillingConfig>>('/water/configs', payload);
    return data.data!;
  },
};
