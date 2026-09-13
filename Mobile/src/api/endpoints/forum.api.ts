import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse } from '@/api/types';

export interface ForumAuthor {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ForumTopic {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  isLocked: boolean;
  createdAt: string;
  createdBy: ForumAuthor;
  _count: { replies: number };
}

export interface ForumReply {
  id: string;
  body: string;
  createdAt: string;
  author: ForumAuthor;
}

export interface ForumTopicDetail extends ForumTopic {
  replies: ForumReply[];
}

export const forumApi = {
  list: async (params?: { page?: number; limit?: number }) => {
    const { data } = await apiClient.get<PaginatedResponse<ForumTopic>>('/forum/topics', { params });
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<ForumTopicDetail>>(`/forum/topics/${id}`);
    return data.data ?? (data as unknown as ForumTopicDetail);
  },

  create: async (payload: { title: string; body: string }) => {
    const { data } = await apiClient.post<ApiResponse<ForumTopic>>('/forum/topics', payload);
    return data.data ?? (data as unknown as ForumTopic);
  },

  reply: async (topicId: string, body: string) => {
    const { data } = await apiClient.post<ApiResponse<ForumReply>>(`/forum/topics/${topicId}/replies`, { body });
    return data.data ?? (data as unknown as ForumReply);
  },

  pin: async (id: string, pinned: boolean): Promise<void> => {
    await apiClient.patch(`/forum/topics/${id}/${pinned ? 'pin' : 'unpin'}`, {});
  },

  lock: async (id: string, locked: boolean): Promise<void> => {
    await apiClient.patch(`/forum/topics/${id}/${locked ? 'lock' : 'unlock'}`, {});
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/forum/topics/${id}`);
  },
};
