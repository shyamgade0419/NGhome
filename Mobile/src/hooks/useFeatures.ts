import { useQuery } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { useAuth } from '@/hooks/useAuth';
import { ALL_ON, FeatureKey, Features, featureForRoute } from '@/features/catalog';

/**
 * Which parts of the app this society uses. Everything is on while it loads, when it cannot be read, and for a server
 * that does not know about features yet, so a screen is never hidden by a failed request.
 */
export function useFeatures(): { features: Features; isOn: (key: FeatureKey) => boolean; routeOn: (route: string) => boolean } {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['society-features'],
    queryFn: societiesApi.getFeatures,
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const features: Features = { ...ALL_ON, ...(data ?? {}) };
  return {
    features,
    isOn: (key) => features[key] !== false,
    routeOn: (route) => {
      const key = featureForRoute(route);
      return key === null || features[key] !== false;
    },
  };
}
