'use client';

/**
 * Chrome shared by every platform-console page: dark sidebar, mobile top bar
 * and the platform-admin gate. Not part of the (dashboard) layout on purpose —
 * that layout assumes a society context, which a platform-admin session never
 * has. The API routes are PlatformAdminGuard-protected either way; the
 * redirect here just keeps a non-admin from staring at an empty page.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookUser, Building2, HardDrive, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Users, X } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { cn } from '@/lib/utils';
import { Loading } from './ui';

const NAV = [
  { href: '/platform', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/platform/societies', label: 'Societies', icon: Building2 },
  { href: '/platform/users', label: 'Users', icon: Users },
  { href: '/platform/contacts', label: 'Contacts', icon: BookUser },
  { href: '/platform/storage', label: 'Storage', icon: HardDrive },
  { href: '/platform/settings', label: 'Settings', icon: Settings },
];

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && user && !user.isPlatformAdmin) router.replace('/');
  }, [isLoading, user, router]);

  useEffect(() => setOpen(false), [pathname]);

  if (isLoading || (user && !user.isPlatformAdmin)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Loading />
      </div>
    );
  }

  // A society's own page (/platform/<id>) belongs under Societies.
  const isActive = (item: (typeof NAV)[number]) => {
    if (item.exact) return pathname === item.href;
    if (item.href === '/platform/societies') {
      const reserved = ['/platform/users', '/platform/contacts', '/platform/storage', '/platform/settings'];
      return pathname === item.href || (pathname.startsWith('/platform/') && !reserved.some((r) => pathname.startsWith(r)));
    }
    return pathname.startsWith(item.href);
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-gray-950">
          <ShieldCheck size={18} />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">NG Home Admin</p>
          <p className="text-[11px] text-gray-500">Platform Console</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3" aria-label="Platform">
        {NAV.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border border-teal-500/30 bg-teal-500/10 text-teal-300'
                  : 'border border-transparent text-gray-400 hover:bg-gray-800/70 hover:text-gray-100',
              )}
            >
              <item.icon size={17} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-800 p-3">
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-gray-800/50 px-3 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500 text-sm font-bold text-gray-950">
            {(user?.firstName?.[0] ?? '?').toUpperCase()}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium text-white">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[11px] text-gray-500">Platform Admin</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800/70 hover:text-gray-100"
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-gray-800 bg-gray-900/60 lg:block">
        {sidebar}
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-800 bg-gray-950/95 px-4 py-3 lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-gray-300">
          <Menu size={20} />
        </button>
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500 text-gray-950">
          <ShieldCheck size={15} />
        </span>
        <span className="text-sm font-semibold text-white">NG Home Admin</span>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-gray-800 bg-gray-900">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 text-gray-400"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="px-4 py-6 sm:px-8 lg:ml-60 lg:py-8">{children}</main>
    </div>
  );
}
