import apiClient from '@/api/client';
import { tokenService } from '@/auth/token.service';
import { ApiResponse } from '@/api/types';
import { LoginResponse, RegisterSocietyPayload, AuthTokens, SocietyMembership } from '@/types/auth.types';

export interface JoinSocietyPayload {
  joinCode: string;
  flatId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export interface SocietyByCode {
  id: string;
  name: string;
  displayName: string;
  flats: Array<{ id: string; flatCode: string; floor?: string; block?: string }>;
}

export const authApi = {
  login: async (credentials: { identifier: string; password: string; societyId?: string }) => {
    const { data } = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', credentials);
    return data.data;
  },

  selectSociety: async (societyId: string) => {
    const { data } = await apiClient.post<ApiResponse<LoginResponse>>('/auth/select-society', { societyId });
    return data.data;
  },

  registerSociety: async (payload: RegisterSocietyPayload) => {
    const { data } = await apiClient.post<ApiResponse<LoginResponse>>('/auth/register-society', payload);
    return data.data;
  },

  /** Look up a society by its public join code — no auth required. */
  getSocietyByCode: async (joinCode: string): Promise<SocietyByCode> => {
    const { data } = await apiClient.get<ApiResponse<SocietyByCode>>(
      `/societies/by-code/${joinCode.toUpperCase().trim()}`,
    );
    return data.data;
  },

  /** Register a new resident and join a society via join code. */
  joinSociety: async (payload: JoinSocietyPayload): Promise<LoginResponse> => {
    const { data } = await apiClient.post<ApiResponse<LoginResponse>>(
      '/auth/join-society',
      payload,
    );
    return data.data;
  },

  logout: async () => {
    const refreshToken = await tokenService.getRefreshToken();
    if (refreshToken) {
      await apiClient.post('/auth/logout', { refreshToken });
    }
  },

  refreshToken: async (refreshToken: string) => {
    const { data } = await apiClient.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken });
    return data.data;
  },

  forgotPassword: async (email: string): Promise<void> => {
    await apiClient.post('/auth/forgot-password', { email });
  },

  getProfile: async () => {
    const { data } = await apiClient.get<ApiResponse<Pick<LoginResponse, 'user' | 'memberships'> & { activeMembership: SocietyMembership | null }>>('/auth/me');
    return data.data;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    await apiClient.post('/auth/change-password', { currentPassword, newPassword });
  },
};
