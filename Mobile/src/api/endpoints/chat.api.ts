import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse } from '@/api/types';

export interface ChatUser {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  sender: ChatUser;
}

export interface ConversationSummary {
  conversationId: string;
  otherUser: ChatUser | null;
  lastMessage: ChatMessage | null;
  hasUnread: boolean;
  updatedAt: string;
}

export const chatApi = {
  /** Idempotent — resolves to the existing 1:1 conversation with this
   *  person if one already exists, rather than creating a duplicate. */
  startConversation: async (userId: string) => {
    const { data } = await apiClient.post<ApiResponse<{ conversationId: string; otherUser: ChatUser | null }>>(
      '/chat/conversations',
      { userId },
    );
    return data.data ?? (data as unknown as { conversationId: string; otherUser: ChatUser | null });
  },

  listConversations: async () => {
    const { data } = await apiClient.get<ApiResponse<ConversationSummary[]>>('/chat/conversations');
    return data.data ?? (data as unknown as ConversationSummary[]);
  },

  /** Poll for messages — no live socket. Screens re-call this on an
   *  interval while the thread is open. */
  listMessages: async (conversationId: string, params?: { page?: number; limit?: number }) => {
    const { data } = await apiClient.get<PaginatedResponse<ChatMessage>>(
      `/chat/conversations/${conversationId}/messages`,
      { params },
    );
    return data;
  },

  sendMessage: async (conversationId: string, body: string) => {
    const { data } = await apiClient.post<ApiResponse<ChatMessage>>(
      `/chat/conversations/${conversationId}/messages`,
      { body },
    );
    return data.data ?? (data as unknown as ChatMessage);
  },

  markRead: async (conversationId: string): Promise<void> => {
    await apiClient.post(`/chat/conversations/${conversationId}/read`, {});
  },
};
