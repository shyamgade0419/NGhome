import apiClient from '@/api/client';
import { PaginatedResponse } from '@/api/types';

export interface DirectoryEntry {
  id: string;
  firstName: string;
  lastName: string;
  memberships: Array<{
    role: string;
    isPrimary: boolean;
    flat: { id: string; flatCode: string; unitNumber: string } | null;
  }>;
}

export const directoryApi = {
  /** Name and flat only — the server never returns email/phone here,
   *  even to an admin caller; see UsersService.getDirectory. */
  list: async (params?: { search?: string; page?: number; limit?: number }) => {
    const { data } = await apiClient.get<PaginatedResponse<DirectoryEntry>>('/users/directory', { params });
    return data;
  },
};
