import { useAuthContext } from '@/auth/AuthContext';
import { SystemRole } from '@/types/auth.types';

export function useAuth() {
  return useAuthContext();
}

export function useCurrentUser() {
  const { user } = useAuthContext();
  return user;
}

export function useIsRole(...roles: SystemRole[]): boolean {
  const { user } = useAuthContext();
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return roles.includes(user.currentRole as SystemRole);
}

export function useIsAdmin(): boolean {
  return useIsRole('SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT', 'COMMITTEE_MEMBER', 'SOCIETY_STAFF');
}

export function useIsSocietyAdmin(): boolean {
  return useIsRole('SOCIETY_ADMIN');
}

export function useIsAccountant(): boolean {
  return useIsRole('SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT');
}

export function useIsResident(): boolean {
  const { user } = useAuthContext();
  if (!user) return false;
  return user.currentRole === 'RESIDENT';
}
