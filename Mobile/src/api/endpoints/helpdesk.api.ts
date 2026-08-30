import apiClient from '@/api/client';

export interface MaintenanceRequest {
  id: string;
  title: string;
  description?: string;
  category: string;
  priority: string;
  status: string;
  adminNotes?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  resident?: { id: string; firstName: string; lastName: string };
  flat?: { id: string; unitNumber: string; flatCode: string };
  assignedTo?: { id: string; firstName: string; lastName: string };
}

export const helpdeskApi = {
  list: async (params?: { status?: string; category?: string; limit?: number }) => {
    const { data } = await apiClient.get<any>('/helpdesk', { params });
    return data;
  },

  create: async (payload: {
    title: string;
    description?: string;
    category?: string;
    priority?: string;
    flatId?: string;
  }) => {
    const { data } = await apiClient.post<any>('/helpdesk', payload);
    return data;
  },

  updateStatus: async (
    id: string,
    payload: { status: string; adminNotes?: string; assignedToId?: string },
  ) => {
    const { data } = await apiClient.patch<any>(`/helpdesk/${id}/status`, payload);
    return data;
  },
};
