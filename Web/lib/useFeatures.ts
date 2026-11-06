'use client';

import { useQuery } from '@tanstack/react-query';
import { societyApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import { ALL_ON, FeatureKey, Features, featureForPath } from '@/lib/features';

/**
 * Which parts of the app this society uses. Everything is on while it loads, when it cannot be read, and for a server that
 * does not know about features yet, so a page is never hidden by a failed request.
 */
export function useFeatures(): { features: Features; isOn: (key: FeatureKey) => boolean; pathOn: (path: string) => boolean } {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['society-features'],
    queryFn: () => societyApi.getFeatures().then((r: any) => (r.data?.features ?? r.features) as Features),
    enabled: !!user && !user.isPlatformAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const features: Features = { ...ALL_ON, ...(data ?? {}) };
  return {
    features,
    isOn: (key) => features[key] !== false,
    pathOn: (path) => {
      const key = featureForPath(path);
      return key === null || features[key] !== false;
    },
  };
}
