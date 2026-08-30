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

export const waterApi = {
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
