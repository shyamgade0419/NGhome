import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';
import type { OnlineOrder } from '@/utils/onlinePayments';

export const onlinePaymentsApi = {
  /** Whether this society has switched on paying a bill from the app. */
  available: async (): Promise<{ enabled: boolean }> => {
    const { data } = await apiClient.get<ApiResponse<{ enabled: boolean }>>('/online-payments/available');
    return data.data;
  },

  /** Start a payment for one of the resident's own bills; returns the Razorpay page to open. */
  start: async (input: { maintenanceBillId: string; amount: string }): Promise<OnlineOrder> => {
    const { data } = await apiClient.post<ApiResponse<OnlineOrder>>('/online-payments/start', input);
    return data.data;
  },

  /** Where a payment stands. The server reads Razorpay first if it is still open. */
  status: async (id: string): Promise<OnlineOrder> => {
    const { data } = await apiClient.get<ApiResponse<OnlineOrder>>(`/online-payments/${id}/status`);
    return data.data;
  },
};
