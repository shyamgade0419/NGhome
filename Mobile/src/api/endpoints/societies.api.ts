import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';
import { Society, Building, Flat, Announcement, Meeting } from '@/types/society.types';

export const societiesApi = {
  getMySociety: async () => {
    const { data } = await apiClient.get<ApiResponse<Society>>('/societies/my');
    return data.data;
  },

  getMySocietyStats: async () => {
    const { data } = await apiClient.get<ApiResponse<{
      buildings: number;
      flats: number;
      members: number;
      currentPeriod: { id: string; periodYear: number; periodMonth: number; status: string } | null;
    }>>('/societies/my/stats');
    return data.data;
  },

  getBuildings: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<Building>>('/buildings', {
      params: query,
    });
    return data;
  },

  getFlats: async (query?: PaginationQuery & { buildingId?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<Flat>>('/flats', { params: query });
    return data;
  },

  getMyFlat: async () => {
    const { data } = await apiClient.get<ApiResponse<Flat>>('/flats/my');
    return data.data;
  },

  getAnnouncements: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<Announcement>>('/announcements', {
      params: query,
    });
    return data;
  },

  getAnnouncement: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<Announcement>>(`/announcements/${id}`);
    return data.data;
  },

  createAnnouncement: async (payload: {
    title: string;
    content: string;
    priority: string;
    publishAt: string;
    expiresAt?: string;
    audience: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<Announcement>>('/announcements', payload);
    return data.data;
  },

  getMeetings: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<Meeting>>('/meetings', {
      params: query,
    });
    return data;
  },

  // ─── Join code ─────────────────────────────────────────────────────────────

  getSocietyConfig: async () => {
    const { data } = await apiClient.get<ApiResponse<Record<string, any>>>('/societies/my/config');
    return data.data;
  },

  /** Return the current join/invite code for this society (admin only). */
  getJoinCode: async (): Promise<{ joinCode: string; generatedAt: string | null }> => {
    const { data } = await apiClient.get<ApiResponse<{ joinCode: string; generatedAt: string | null }>>(
      '/societies/my/join-code',
    );
    return data.data;
  },

  /** Rotate the join code — old code is immediately invalidated (admin only). */
  regenerateJoinCode: async (): Promise<{ joinCode: string; generatedAt: string }> => {
    const { data } = await apiClient.patch<ApiResponse<{ joinCode: string; generatedAt: string }>>(
      '/societies/my/regenerate-join-code',
    );
    return data.data;
  },

  // Admin: list all residents in the society
  getResidents: async (query?: PaginationQuery & { buildingId?: string; flatId?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<{
      id: string;
      userId: string;
      displayName: string;
      email: string;
      phone: string | null;
      flatNumber: string;
      buildingName: string;
      role: string;
      status: string;
    }>>('/users/society', { params: query });
    return data;
  },
};
