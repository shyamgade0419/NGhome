import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

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
};
