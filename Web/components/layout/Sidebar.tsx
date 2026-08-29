'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';

const NAV = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/billing', icon: Receipt, label: 'Billing' },
  { href: '/payments', icon: CreditCard, label: 'Payments' },
  { href: '/expenses', icon: Wallet, label: 'Expenses' },
  { href: '/accounts', icon: Landmark, label: 'Accounts' },
  { href: '/residents', icon: Users, label: 'Residents' },
  { href: '/flats', icon: Home, label: 'Flats' },
  { href: '/reports', icon: BarChart3, label: 'Reports' },
  { href: '/community', icon: Megaphone, label: 'Community' },
  { href: '/notifications', icon: Bell, label: 'Notifications' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-slate-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5">
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
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
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
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
            {user ? initials(user.displayName) : '…'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-900">{user?.displayName}</p>
            <p className="truncate text-[10px] text-slate-400">
              {user?.currentRole?.replace(/_/g, ' ')}
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
  );
}
