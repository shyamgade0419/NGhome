'use client';

import { usePathname } from 'next/navigation';
import { Bell, Menu } from 'lucide-react';
import { areaForPath } from '@/lib/areas';
import { tint, tones } from '@/lib/tones';
import { useSidebar } from './SidebarContext';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  const { toggle } = useSidebar();
  const area = areaForPath(usePathname());
  const AreaIcon = area?.icon;

  return (
    <header
      className="flex h-14 flex-shrink-0 items-center justify-between border-b bg-white px-4 lg:h-16 lg:px-6"
      style={{ borderBottomColor: area ? tint(tones[area.tone], 0.6) : '#E8DFCD', borderBottomWidth: area ? 2 : 1, backgroundColor: area ? tint(tones[area.tone], 0.94) : undefined }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggle}
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>

        {area && AreaIcon && (
          <span className="hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl sm:flex" style={{ backgroundColor: tint(tones[area.tone], 0.84), color: tones[area.tone] }} aria-hidden="true">
            <AreaIcon size={18} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate font-display text-base font-bold text-slate-900 lg:text-lg">{title}</h1>
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
