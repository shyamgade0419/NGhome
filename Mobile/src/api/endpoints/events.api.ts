import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';

export type EventStatus = 'PLANNED' | 'COMPLETED' | 'CANCELLED';

// Matches backend Event Prisma model
export interface SocietyEvent {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  fundId: string | null;
  fund?: { id: string; name: string } | null;
  estimatedCost: string | null;
  actualCost: string | null;
  status: EventStatus;
  isVisibleToResidents: boolean;
  createdById: string;
  createdBy?: { id: string; firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
  // Whether actualCost has already been turned into a real Expense —
  // linking a fund alone never moves money, see recordExpense().
  expenseRecorded?: boolean;
}

export interface EventPayload {
  title: string;
  description?: string;
  eventDate: string;
  fundId?: string | null;
  estimatedCost?: number;
  actualCost?: number;
  status?: EventStatus;
  isVisibleToResidents?: boolean;
}

export const eventsApi = {
  list: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<SocietyEvent>>('/events', {
      params: query,
    });
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<SocietyEvent>>(`/events/${id}`);
    return data.data;
  },

  create: async (payload: EventPayload) => {
    const { data } = await apiClient.post<ApiResponse<SocietyEvent>>('/events', payload);
    return data.data;
  },

  update: async (id: string, payload: Partial<EventPayload>) => {
    const { data } = await apiClient.patch<ApiResponse<SocietyEvent>>(`/events/${id}`, payload);
    return data.data;
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/events/${id}`);
  },

  /** Turns actualCost into a real Expense, debiting the linked fund. */
  recordExpense: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<{ id: string }>>(`/events/${id}/record-expense`);
    return data.data;
  },
};
