import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

/** Someone whose membership was ended but whose account still exists. */
export interface RemovedMember {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  flatCode: string | null;
  role: string;
  removedAt: string | null;
}

export interface MemberDeletionPreview {
  user: { id: string; name: string; email: string; phone: string | null };
  /** What goes with the account. */
  willRemove: { label: string; count: number }[];
  /** Records the society keeps (payments, notices…) — any of these stops the delete. */
  blockedBy: { label: string; count: number }[];
  /** Plain-language reasons it cannot be done (also in another society, only admin, yourself…). */
  reasons: string[];
  canDelete: boolean;
}

export const membersApi = {
  removedMembers: async () => {
    const { data } = await apiClient.get<ApiResponse<RemovedMember[]>>('/users/society/removed');
    return data.data ?? [];
  },

  /** What deleting this account would erase, and anything that prevents it. Changes nothing. */
  deletionPreview: async (userId: string) => {
    const { data } = await apiClient.get<ApiResponse<MemberDeletionPreview>>(`/users/society/${userId}/deletion-preview`);
    return data.data;
  },

  /**
   * Erases the account for good — no undo. POST with a body rather than DELETE:
   * the typed email is re-checked on the server before anything is removed.
   */
  deleteMember: async (userId: string, confirmEmail: string) => {
    const { data } = await apiClient.post<ApiResponse<{ id: string; name: string; email: string }>>(
      `/users/society/${userId}/delete`,
      { confirmEmail },
    );
    return data.data;
  },
};
