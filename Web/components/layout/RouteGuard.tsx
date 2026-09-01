'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';

/**
 * Paths that are exclusively for admin / staff roles.
 * Residents who navigate here by URL are redirected to '/'.
 * Note: /billing/my is an exception inside /billing — residents may visit it.
 */
const ADMIN_ONLY_PREFIXES = [
  '/billing',       // except /billing/my handled below
  '/payments',
  '/expenses',
  '/accounts',
  '/residents',
  '/flats',
  '/water',
  '/reports',
  '/salaries',
  '/audit-logs',
  '/settings',
  '/meetings',
];

const ADMIN_ROLES = ['SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT', 'SOCIETY_STAFF', 'PLATFORM_ADMIN'];

function isAdminOnlyPath(pathname: string): boolean {
  // Resident-accessible billing paths
  if (pathname === '/billing/my' || pathname.startsWith('/billing/my/')) return false;
  if (pathname === '/billing/statement' || pathname.startsWith('/billing/statement/')) return false;
  return ADMIN_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, activeMembership, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;

    const role = activeMembership?.role ?? user?.currentRole ?? '';
    const isAdmin = ADMIN_ROLES.includes(role) || !!user?.isPlatformAdmin;

    if (!isAdmin && isAdminOnlyPath(pathname)) {
      router.replace('/');
    }
  }, [isLoading, user, activeMembership, pathname, router]);

  return <>{children}</>;
}
