import apiClient from '@/api/client';
import { PaginatedResponse } from '@/api/types';

export interface AuditLogEntry {
  id: string;
  actorId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  actor?: { firstName: string; lastName: string } | null;
}

export const auditLogsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    action?: string;
    entityType?: string;
    fromDate?: string;
    toDate?: string;
  }) => {
    const { data } = await apiClient.get<PaginatedResponse<AuditLogEntry>>('/audit-logs', { params });
    return data;
  },
};
