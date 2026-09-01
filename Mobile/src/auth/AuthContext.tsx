import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
} from 'react';
import { authApi } from '@/api/endpoints/auth.api';
import { tokenService } from '@/auth/token.service';
import { setAuthLogoutCallback } from '@/api/client';
import { AuthenticatedUser, SocietyMembership } from '@/types/auth.types';

interface AuthState {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSocietySelection: boolean;
  pendingMemberships: SocietyMembership[];
}

interface AuthContextValue extends AuthState {
  /** Returns true if society selection is required after login */
  login: (identifier: string, password: string) => Promise<boolean>;
  selectSociety: (societyId: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    needsSocietySelection: false,
    pendingMemberships: [],
  });

  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // best-effort — clear local state regardless
    } finally {
      await tokenService.clearTokens();
      if (mounted.current) {
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          needsSocietySelection: false,
          pendingMemberships: [],
        });
      }
    }
  }, []);

  // Wire axios interceptor so 401-on-refresh triggers logout
  useEffect(() => {
    setAuthLogoutCallback(logout);
  }, [logout]);

  // Restore session on app start
  useEffect(() => {
    async function restoreSession() {
      try {
        const token = await tokenService.getAccessToken();
        if (!token) {
          setState((s) => ({ ...s, isLoading: false }));
          return;
        }
        const { user, memberships, activeMembership } = await authApi.getProfile();
        // DEFECT-10: Use activeMembership from JWT context — not memberships[0].
        // The JWT contains the membershipId of the society the user last selected,
        // so the backend returns the correct active society via activeMembership.
        const active = activeMembership ?? memberships[0];
        if (mounted.current) {
          setState({
            user: {
              ...user,
              memberships,
              currentRole: active?.role,
              societyId: active?.societyId,
              flatId: active?.flatId ?? undefined,
              flatNumber: active?.flatNumber ?? null,
              buildingName: active?.buildingName ?? null,
            },
            isAuthenticated: true,
            isLoading: false,
            needsSocietySelection: false,
            pendingMemberships: [],
          });
        }
      } catch {
        await tokenService.clearTokens();
        if (mounted.current) {
          setState({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            needsSocietySelection: false,
            pendingMemberships: [],
          });
        }
      }
    }
    restoreSession();
  }, []);

  const login = useCallback(async (identifier: string, password: string): Promise<boolean> => {
    const result = await authApi.login({ identifier, password });
    await tokenService.setTokens(result.accessToken, result.refreshToken);

    if (result.requiresSocietySelection && result.memberships.length > 1) {
      if (mounted.current) {
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          needsSocietySelection: true,
          pendingMemberships: result.memberships,
        });
      }
      return true; // caller should navigate to society-select
    }

    const activeMembership = result.memberships[0];
    if (mounted.current) {
      setState({
        user: {
          ...result.user,
          memberships: result.memberships,
          currentRole: activeMembership?.role,
          societyId: activeMembership?.societyId,
          flatId: activeMembership?.flatId ?? undefined,
          flatNumber: activeMembership?.flatNumber ?? null,
          buildingName: activeMembership?.buildingName ?? null,
        },
        isAuthenticated: true,
        isLoading: false,
        needsSocietySelection: false,
        pendingMemberships: [],
      });
    }
    return false;
  }, []);

  const selectSociety = useCallback(async (societyId: string) => {
    const result = await authApi.selectSociety(societyId);
    await tokenService.setTokens(result.accessToken, result.refreshToken);
    const selected = result.memberships.find((m) => m.societyId === societyId) ?? result.memberships[0];
    if (mounted.current) {
      setState({
        user: {
          ...result.user,
          memberships: result.memberships,
          currentRole: selected?.role,
          societyId: selected?.societyId,
          flatId: selected?.flatId ?? undefined,
          flatNumber: selected?.flatNumber ?? null,
          buildingName: selected?.buildingName ?? null,
        },
        isAuthenticated: true,
        isLoading: false,
        needsSocietySelection: false,
        pendingMemberships: [],
      });
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user, memberships, activeMembership } = await authApi.getProfile();
      // DEFECT-10: Use activeMembership from backend (derived from JWT's membershipId)
      const active = activeMembership ?? memberships[0];
      if (mounted.current) {
        setState((s) => ({
          ...s,
          user: {
            ...(s.user ?? {}),
            ...user,
            memberships,
            currentRole: active?.role ?? s.user?.currentRole,
            societyId: active?.societyId ?? s.user?.societyId,
            flatId: active?.flatId ?? s.user?.flatId ?? undefined,
            flatNumber: active?.flatNumber ?? s.user?.flatNumber ?? null,
            buildingName: active?.buildingName ?? s.user?.buildingName ?? null,
          } as AuthenticatedUser,
          isAuthenticated: true,
        }));
      }
    } catch {
      // silently ignore — refreshUser is best-effort
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, selectSociety, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
