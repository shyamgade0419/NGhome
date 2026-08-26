import { Redirect } from 'expo-router';
import { useAuthContext } from '@/auth/AuthContext';
import { LoadingState } from '@/components/ui/LoadingState';

const ADMIN_ROLES = new Set([
  'SOCIETY_ADMIN',
  'SOCIETY_ACCOUNTANT',
  'SOCIETY_STAFF',
  'COMMITTEE_MEMBER',
  'PLATFORM_ADMIN',
]);

export default function AppIndex() {
  const { user, isLoading } = useAuthContext();

  if (isLoading || !user) return <LoadingState fullscreen message="Loading..." />;

  if (user.isPlatformAdmin || ADMIN_ROLES.has(user.currentRole ?? '')) {
    return <Redirect href="/(app)/admin" />;
  }

  return <Redirect href="/(app)/resident" />;
}
