import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import apiClient, { API_BASE_URL } from '@/api/client';
import { tokenService } from '@/auth/token.service';
import { ApiResponse } from '@/api/types';

export type DocumentAccessLevel =
  | 'PUBLIC'
  | 'RESIDENTS_ONLY'
  | 'COMMITTEE_ONLY'
  | 'ADMIN_ONLY'
  | 'FLAT_PRIVATE';

export interface SocietyDocument {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  storageProvider?: string;
  accessLevel: DocumentAccessLevel;
  category: string | null;
  flatId?: string | null;
  createdAt: string;
  uploadedBy?: { firstName: string; lastName: string } | null;
}

export const documentsApi = {
  /**
   * List society documents. The API scopes by accessLevel for the caller's role
   * (residents also see their own flat's FLAT_PRIVATE documents server-side —
   * nothing to filter client-side, the backend never sends what shouldn't be
   * visible). DocumentsService.findAll returns a bare array (no {data, meta}
   * wrapper) — mirror web's `.data ?? r` fallback rather than assume it exists.
   */
  list: async (params?: { category?: string }) => {
    const { data } = await apiClient.get<SocietyDocument[] | { data: SocietyDocument[] }>(
      '/documents',
      { params },
    );
    const docs = Array.isArray(data) ? data : (data?.data ?? []);
    return { data: docs, meta: { total: docs.length, page: 1, limit: docs.length, totalPages: 1 } };
  },

  /** Admin's paste-a-link flow — no actual file, just metadata pointing
   *  somewhere already hosted. Kept for parity with web's existing form. */
  create: async (payload: {
    title: string;
    description?: string;
    fileName: string;
    fileKey: string;
    fileSize: number;
    mimeType: string;
    accessLevel: DocumentAccessLevel;
    category?: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<SocietyDocument>>('/documents', payload);
    return data.data ?? (data as unknown as SocietyDocument);
  },

  /**
   * Real file upload, backed by the society's SFTP server (POST /documents/
   * upload). A resident's upload is forced to FLAT_PRIVATE on their own flat
   * server-side no matter what's sent here — accessLevel/flatId only matter
   * for an admin/staff caller choosing where an official document is visible.
   *
   * RN's networking layer needs the file appended to FormData as a plain
   * {uri, name, type} object (not a real Blob) and Content-Type left as the
   * bare "multipart/form-data" string — it fills in the boundary itself;
   * apiClient's default 'application/json' header must be overridden here
   * or the request body silently becomes the wrong shape.
   */
  upload: async (
    file: { uri: string; name: string; mimeType?: string | null },
    meta: { title: string; description?: string; category?: string; accessLevel?: DocumentAccessLevel; flatId?: string },
  ) => {
    const form = new FormData();
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    } as unknown as Blob);
    form.append('title', meta.title);
    if (meta.description) form.append('description', meta.description);
    if (meta.category) form.append('category', meta.category);
    if (meta.accessLevel) form.append('accessLevel', meta.accessLevel);
    if (meta.flatId) form.append('flatId', meta.flatId);

    const { data } = await apiClient.post<ApiResponse<SocietyDocument>>('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data.data ?? (data as unknown as SocietyDocument);
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<SocietyDocument>>(`/documents/${id}`);
    return data.data ?? (data as unknown as SocietyDocument);
  },

  /**
   * Downloads an uploaded (SFTP-backed) document to the device and opens
   * the OS share/preview sheet — there's no in-app viewer, so this mirrors
   * how the Maintenance Sheet's PDF export already hands a file to the
   * platform via expo-sharing rather than rendering it in-app.
   */
  openFile: async (id: string, fileName: string): Promise<void> => {
    const token = await tokenService.getAccessToken();
    const localUri = `${FileSystem.cacheDirectory}${Date.now()}-${fileName}`;
    const result = await FileSystem.downloadAsync(`${API_BASE_URL}/documents/${id}/file`, localUri, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (result.status !== 200) {
      throw new Error(`Failed to download file (status ${result.status})`);
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(result.uri);
    }
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/documents/${id}`);
  },
};
