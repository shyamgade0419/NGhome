import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse } from '@/api/types';

export type DocumentAccessLevel = 'PUBLIC' | 'RESIDENTS_ONLY' | 'COMMITTEE_ONLY' | 'ADMIN_ONLY';

export interface SocietyDocument {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  accessLevel: DocumentAccessLevel;
  category: string | null;
  createdAt: string;
  uploadedBy?: { firstName: string; lastName: string } | null;
}

export const documentsApi = {
  /** List society documents. The API scopes by accessLevel for the caller's role. */
  list: async (params?: { category?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<SocietyDocument>>('/documents', { params });
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<SocietyDocument>>(`/documents/${id}`);
    return data.data ?? (data as unknown as SocietyDocument);
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/documents/${id}`);
  },
};
