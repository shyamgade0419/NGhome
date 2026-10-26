'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthContext';
import { applyBrandColor, Branding } from '@/lib/branding';

const BrandingContext = createContext<Branding | null>(null);

/** The signed-in society's branding, or null when it has none (everyone sees plain NG Home). */
export function useBranding(): Branding | null {
  return useContext(BrandingContext);
}

/**
 * Loads the society's branding after sign-in and applies its colour to the
 * whole dashboard. Platform admins have no society and keep the console's own
 * look, so nothing is fetched or applied for them.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const enabled = !!user && !user.isPlatformAdmin;

  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get('/societies/my/branding').then((r) => r.data as Branding),
    enabled,
    staleTime: 5 * 60_000,
    // A missing or failed branding call must never get in the way of the app.
    retry: false,
  });

  const branding = useMemo<Branding | null>(() => {
    if (!enabled || !data) return null;
    return data.appName || data.primaryColor || data.logoDataUri ? data : null;
  }, [enabled, data]);

  useEffect(() => {
    applyBrandColor(branding?.primaryColor);
    return () => applyBrandColor(null);
  }, [branding?.primaryColor]);

  useEffect(() => {
    const name = branding?.appName;
    if (!name) return;
    const previous = document.title;
    // Next rewrites the title from the root layout on each client-side
    // navigation (e.g. right after sign-in), so keep re-asserting the name.
    const apply = () => {
      if (document.title !== name) document.title = name;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = previous;
    };
  }, [branding?.appName]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
