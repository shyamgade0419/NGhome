'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '@/lib/api/auth';
import type { User, SocietyMembership } from '@/lib/types';

interface AuthState {
  user: User | null;
  memberships: SocietyMembership[];
  activeMembership: SocietyMembership | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<{ requiresSocietySelection?: boolean; isPlatformAdmin?: boolean }>;
  selectSociety: (membershipId: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<SocietyMembership[]>([]);
  const [activeMembership, setActiveMembership] = useState<SocietyMembership | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me.user);
      setMemberships(me.memberships ?? []);
      setActiveMembership(me.activeMembership ?? null);
    } catch {
      setUser(null);
      setMemberships([]);
      setActiveMembership(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setIsLoading(false));
  }, [refreshUser]);

  const login = async (identifier: string, password: string) => {
    const result = await authApi.login(identifier, password);
    if (result.requiresSocietySelection) {
      setMemberships(result.memberships ?? []);
      return { requiresSocietySelection: true };
    }
    setUser(result.user);
    setMemberships(result.memberships ?? []);
    // Nothing else refreshes this after login (no dashboard layout calls
    // refreshUser() on mount), so without this, activeMembership stayed
    // null — and stale/null — until the user happened to hit a page that
    // does call refreshUser() or reloaded the tab. Anything gating on
    // activeMembership (e.g. Residents' "can send notifications" check)
    // would silently misbehave for that whole window.
    setActiveMembership(result.activeMembership ?? result.memberships?.[0] ?? null);
    return { isPlatformAdmin: result.user.isPlatformAdmin };
  };

  const selectSociety = async (membershipId: string) => {
    const result = await authApi.selectSociety(membershipId);
    setUser(result.user);
    setMemberships(result.memberships ?? []);
    // activeMembership from the response is the source of truth for which
    // membership is now active — matching by societyId here would silently
    // pick the wrong one whenever the person holds two memberships in the
    // same society.
    setActiveMembership(
      result.activeMembership ?? result.memberships?.find((m) => m.id === membershipId) ?? null,
    );
  };

  const logout = async () => {
    await authApi.logout().catch(() => {});
    setUser(null);
    setMemberships([]);
    setActiveMembership(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, memberships, activeMembership, isLoading, login, selectSociety, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
