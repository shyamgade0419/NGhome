import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';

export interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  sentByName?: string | null;
}

export const notificationsApi = {
  /** Resident: get my notifications (paginated). */
  getMine: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<Notification>>(
      '/notifications/my',
      { params: query },
    );
    return data;
  },

  /** Mark a single notification as read. */
  markRead: async (id: string): Promise<void> => {
    await apiClient.patch(`/notifications/my/${id}/read`, {});
  },

  /** Admin: send a push notification to all members. */
  send: async (payload: { title: string; message: string }): Promise<void> => {
    await apiClient.post('/notifications', payload);
  },
};
