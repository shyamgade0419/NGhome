import { useQuery } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/theme';
import { ResolvedBranding, resolveBranding } from '@/utils/branding';

/**
 * The signed-in society's branding, resolved against the app's own colours.
 * A society that has none — or a request that fails — gets exactly the NG Home
 * look, so branding can never get in the way of using the app.
 */
export function useBranding(): ResolvedBranding {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: societiesApi.getBranding,
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return resolveBranding(data, { color: colors.primary, tint: colors.primaryLight, onTint: colors.primary });
}
