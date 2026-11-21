import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';
import type { UtilityConnection, UtilityProvider } from '@/utils/utilities';

export interface ConnectionInput {
  providerCode: string;
  /** Required for OTHER. */
  providerName?: string;
  /** Optional for OTHER: the company's own https website. */
  providerUrl?: string;
  consumerNumber: string;
  nickname?: string;
  reminderDay?: number;
  remindersOn?: boolean;
}

export const utilitiesApi = {
  /** The electricity companies to choose from, and the default reminder day. */
  providers: async (): Promise<{ electricity: UtilityProvider[]; defaultReminderDay: number }> => {
    const { data } = await apiClient.get<ApiResponse<{ electricity: UtilityProvider[]; defaultReminderDay: number }>>('/utility-connections/providers');
    return data.data;
  },

  /** My flat's saved connections. */
  mine: async (): Promise<UtilityConnection[]> => {
    const { data } = await apiClient.get<ApiResponse<UtilityConnection[]>>('/utility-connections');
    return data.data ?? [];
  },

  create: async (input: ConnectionInput): Promise<UtilityConnection> => {
    const { data } = await apiClient.post<ApiResponse<UtilityConnection>>('/utility-connections', input);
    return data.data;
  },

  update: async (id: string, input: Partial<ConnectionInput>): Promise<UtilityConnection> => {
    const { data } = await apiClient.patch<ApiResponse<UtilityConnection>>(`/utility-connections/${id}`, input);
    return data.data;
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/utility-connections/${id}`);
  },
};
