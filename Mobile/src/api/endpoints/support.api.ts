import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

/** `support` is null unless the platform admin has switched the note on with a UPI ID. */
export interface SupportInfo {
  pricingMode: 'FREE' | 'PAID';
  support: { upiId: string; payeeName: string; message: string } | null;
}

export const supportApi = {
  info: async () => {
    const { data } = await apiClient.get<ApiResponse<SupportInfo>>('/support');
    return data.data;
  },
};
