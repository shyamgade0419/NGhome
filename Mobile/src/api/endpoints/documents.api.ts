import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

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
  /**
   * List society documents. The API scopes by accessLevel for the caller's role.
   * DocumentsService.findAll returns a bare array (prisma.document.findMany()
   * directly, no {data, meta} wrapper) — unlike every other list endpoint in
   * this API. The web client already works around this with `.data ?? r`;
   * mirror that here rather than assume the wrapper exists.
   */
  list: async (params?: { category?: string }) => {
    const { data } = await apiClient.get<SocietyDocument[] | { data: SocietyDocument[] }>(
      '/documents',
      { params },
    );
    const docs = Array.isArray(data) ? data : (data?.data ?? []);
    return { data: docs, meta: { total: docs.length, page: 1, limit: docs.length, totalPages: 1 } };
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<SocietyDocument>>(`/documents/${id}`);
    return data.data ?? (data as unknown as SocietyDocument);
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/documents/${id}`);
  },
};
