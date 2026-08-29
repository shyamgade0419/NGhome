'use client';

import { Bell, Menu } from 'lucide-react';
import { useSidebar } from './SidebarContext';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  const { toggle } = useSidebar();

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:h-16 lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggle}
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-900 lg:text-lg">{title}</h1>
          {subtitle && (
            <p className="truncate text-xs text-slate-500 leading-none mt-0.5 hidden sm:block">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 lg:gap-3">
        {actions && <div className="flex items-center gap-2">{actions}</div>}
        <button
          className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
          aria-label="Notifications"
        >
          <Bell size={16} />
        </button>
      </div>
    </header>
  );
}
