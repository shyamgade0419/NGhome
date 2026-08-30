'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  LayoutDashboard,
  Receipt,
  CreditCard,
  Wallet,
  BarChart3,
  Megaphone,
  Settings,
  LogOut,
  Building2,
  Users,
  Home,
  Landmark,
  Bell,
  Droplets,
  FileText,
  UserCircle,
  CalendarDays,
  FolderOpen,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';
import { useSidebar } from './SidebarContext';

/* Admin + Staff nav */
const ADMIN_NAV = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/billing', icon: Receipt, label: 'Billing' },
  { href: '/billing/my', icon: FileText, label: 'My Bills' },
  { href: '/payments', icon: CreditCard, label: 'Payments' },
  { href: '/expenses', icon: Wallet, label: 'Expenses' },
  { href: '/accounts', icon: Landmark, label: 'Accounts' },
  { href: '/residents', icon: Users, label: 'Residents' },
  { href: '/flats', icon: Home, label: 'Flats' },
  { href: '/water', icon: Droplets, label: 'Water Billing' },
  { href: '/reports', icon: BarChart3, label: 'Reports' },
  { href: '/community', icon: Megaphone, label: 'Community' },
  { href: '/helpdesk', icon: Wrench, label: 'Helpdesk' },
  { href: '/meetings', icon: CalendarDays, label: 'Meetings' },
  { href: '/documents', icon: FolderOpen, label: 'Documents' },
  { href: '/salaries', icon: UserCircle, label: 'Salaries' },
  { href: '/audit-logs', icon: ShieldCheck, label: 'Audit Logs' },
  { href: '/notifications', icon: Bell, label: 'Notifications' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

/* Resident-only nav */
const RESIDENT_NAV = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/billing/my', icon: FileText, label: 'My Bills' },
  { href: '/community', icon: Megaphone, label: 'Community' },
  { href: '/helpdesk', icon: Wrench, label: 'Helpdesk' },
  { href: '/documents', icon: FolderOpen, label: 'Documents' },
  { href: '/notifications', icon: Bell, label: 'Notifications' },
];

const ADMIN_ROLES = ['SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT', 'SOCIETY_STAFF', 'PLATFORM_ADMIN'];

export function Sidebar() {
  const pathname = usePathname();
  const { user, activeMembership, logout } = useAuth();
  const { isOpen, close } = useSidebar();

  // Auto-close on mobile when navigating to a new route
  useEffect(() => {
    close();
  }, [pathname, close]);

  const role = activeMembership?.role ?? user?.currentRole ?? '';
  const isAdmin = ADMIN_ROLES.includes(role) || !!user?.isPlatformAdmin;
  const NAV = isAdmin ? ADMIN_NAV : RESIDENT_NAV;

  return (
    <>
      {/* Mobile backdrop — tap to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          // Base — fixed overlay on mobile
          'fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col',
          'border-r border-slate-200 bg-white',
          'transition-transform duration-300 ease-in-out',
          // Desktop — back in the flex flow, always visible, no transform
          'lg:static lg:h-screen lg:w-60 lg:translate-x-0 lg:transition-none lg:z-auto',
          // Mobile open / closed
          isOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-16 flex-shrink-0 items-center gap-2.5 border-b border-slate-100 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
            <Building2 size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 leading-none">NG Home</p>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5">by NovaGade</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5 scrollbar-thin">
          {NAV.map(({ href, icon: Icon, label }) => {
            // Exact match for '/', prefix match for everything else.
            // /billing/my must not match /billing, so check prefix with trailing slash.
            const active =
              href === '/'
                ? pathname === '/'
                : pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon size={18} className={active ? 'text-primary-600' : ''} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="flex-shrink-0 border-t border-slate-100 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
              {user ? initials(user.displayName) : '…'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-900">{user?.displayName}</p>
              <p className="truncate text-[10px] text-slate-400">
                {(role || 'User').replace(/_/g, ' ')}
              </p>
            </div>
            <button
              onClick={logout}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
