'use client';

/**
 * Chrome shared by every platform-console page: header, tabs and the
 * platform-admin gate. Not part of the (dashboard) layout on purpose — that
 * layout assumes a society context, which a platform-admin session never has.
 * The API routes are PlatformAdminGuard-protected either way; the redirect
 * here just keeps a non-admin from staring at an empty page.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { PageSpinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/platform', label: 'Societies' },
  { href: '/platform/users', label: 'Users' },
];

export function PlatformShell({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && user && !user.isPlatformAdmin) router.replace('/');
  }, [isLoading, user, router]);

  if (isLoading || (user && !user.isPlatformAdmin)) {
    return <div className="flex min-h-screen items-center justify-center"><PageSpinner /></div>;
  }

  // A society's own page (/platform/<id>) belongs under the Societies tab.
  const activeHref = pathname.startsWith('/platform/users') ? '/platform/users' : '/platform';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6">
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
              <ShieldCheck size={16} />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-900">NG Home — Platform Console</h1>
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
        <nav className="-mb-px flex gap-6">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'border-b-2 pb-2.5 text-sm font-medium',
                activeHref === t.href
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
