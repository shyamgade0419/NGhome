import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';
import { WhatsappMessageRow, WhatsappStatus } from '@/utils/reminders';

export const whatsappApi = {
  /** Is WhatsApp connected to the server, and what is waiting to be sent. */
  status: async (): Promise<WhatsappStatus> => {
    const { data } = await apiClient.get<ApiResponse<WhatsappStatus>>('/whatsapp/status');
    return data.data;
  },

  messages: async (limit = 12): Promise<WhatsappMessageRow[]> => {
    const { data } = await apiClient.get<ApiResponse<WhatsappMessageRow[]>>('/whatsapp/messages', { params: { limit } });
    return data.data ?? [];
  },

  /** Sends one message to a number to prove the connection works (admin only). */
  test: async (phone: string): Promise<{ sent: boolean; error?: string }> => {
    const { data } = await apiClient.post<ApiResponse<{ sent: boolean; error?: string }>>('/whatsapp/test', { phone });
    return data.data;
  },

  /** Switch automation on or off, and choose the reminder days (admin only). */
  saveSettings: async (settings: { enabled: boolean; reminderDays: number[] }): Promise<void> => {
    await apiClient.patch('/societies/my/config', { whatsappEnabled: settings.enabled, whatsappReminderDays: settings.reminderDays });
  },
};
