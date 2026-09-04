import axios from 'axios';
import { api } from '@/lib/api/client';
import type { User, SocietyMembership } from '@/lib/types';

interface LoginResult {
  user: User;
  memberships: SocietyMembership[];
  activeMembership?: SocietyMembership;
  requiresSocietySelection?: boolean;
}

interface MeResult {
  user: User;
  memberships: SocietyMembership[];
  activeMembership: SocietyMembership | null;
}

export const authApi = {
  login: async (identifier: string, password: string): Promise<LoginResult> => {
    const res = await axios.post('/api/auth/login', { identifier, password });
    return res.data;
  },

  // Keyed by the specific membership id, not societyId — a person can hold
  // more than one active membership in the same society (e.g. a society
  // admin who is also a resident of their own flat), and societyId alone
  // can't tell those two apart.
  selectSociety: async (
    membershipId: string,
  ): Promise<{ user: User; memberships: SocietyMembership[]; activeMembership?: SocietyMembership }> => {
    const res = await axios.post('/api/auth/select-society', { membershipId });
    return res.data;
  },

  logout: async () => {
    await axios.post('/api/auth/logout');
  },

  // Uses the configured api client so it goes through the BFF proxy with auth cookie.
  // Backend returns { success: true, data: { user, memberships } };
  // the client interceptor unwraps to { user, memberships }.
  me: async (): Promise<MeResult> => {
    const res = await api.get('/auth/me');
    return res.data;
  },

  forgotPassword: async (email: string): Promise<void> => {
    await axios.post('/api/auth/forgot-password', { email });
  },

  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    await axios.post('/api/auth/reset-password', { token, newPassword });
  },
};
