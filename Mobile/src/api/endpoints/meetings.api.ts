import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';

export interface MeetingMinutes {
  id: string;
  content: string;
  summary: string | null;
  createdAt: string;
}

export interface SocietyMeeting {
  id: string;
  title: string;
  meetingDate: string;
  location: string | null;
  agenda: string | null;
  isPublished: boolean;
  createdAt: string;
  minutes?: MeetingMinutes | null;
  attendees?: Array<{ id: string; name: string; flatCode?: string | null; role?: string | null }>;
}

export const meetingsApi = {
  list: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<SocietyMeeting>>('/meetings', {
      params: query,
    });
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<SocietyMeeting>>(`/meetings/${id}`);
    return data.data ?? (data as unknown as SocietyMeeting);
  },

  create: async (payload: {
    title: string;
    meetingDate: string;
    location?: string;
    agenda?: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<SocietyMeeting>>('/meetings', payload);
    return data.data ?? (data as unknown as SocietyMeeting);
  },

  addMinutes: async (id: string, payload: { content: string; summary?: string }): Promise<void> => {
    await apiClient.post(`/meetings/${id}/minutes`, payload);
  },

  publish: async (id: string): Promise<void> => {
    await apiClient.post(`/meetings/${id}/publish`, {});
  },
};
