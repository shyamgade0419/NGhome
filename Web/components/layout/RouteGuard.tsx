'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
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
  '/visitors',
];

const ADMIN_ROLES = ['SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT', 'SOCIETY_STAFF', 'PLATFORM_ADMIN'];

/** The committee is not in the general admin list, but may open these pages — the API allows it. */
const COMMITTEE_PATHS = ['/visitors'];
const isCommitteePath = (pathname: string) => COMMITTEE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

function isAdminOnlyPath(pathname: string): boolean {
  // Resident-accessible billing paths
  if (pathname === '/billing/my' || pathname.startsWith('/billing/my/')) return false;
  if (pathname === '/billing/statement' || pathname.startsWith('/billing/statement/')) return false;
  return ADMIN_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, activeMembership, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;

    const role = activeMembership?.role ?? user?.currentRole ?? '';
    const isAdmin = ADMIN_ROLES.includes(role) || !!user?.isPlatformAdmin;
    const committeeMayOpen = role === 'COMMITTEE_MEMBER' && isCommitteePath(pathname);

    if (!isAdmin && !committeeMayOpen && isAdminOnlyPath(pathname)) {
      router.replace('/');
    }
  }, [isLoading, user, activeMembership, pathname, router]);

  const role = activeMembership?.role ?? user?.currentRole ?? '';
  if (!isLoading && role === 'SECURITY_GUARD' && !user?.isPlatformAdmin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
          <ShieldCheck size={28} />
        </div>
        <h1 className="text-xl font-bold text-slate-900">The gate is in the mobile app</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          Registering visitors, checking invitation codes and recording entry and exit are done in the NG Home app on your
          phone. Open it there to start your shift.
        </p>
        <button
          onClick={() => void logout()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Sign out
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
