'use client';

import { Droplets, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setLook, useLook, type Look } from '@/lib/look';

const OPTIONS: { value: Look; label: string; icon: typeof Droplets }[] = [
  { value: 'glass', label: 'Glass', icon: Droplets },
  { value: 'classic', label: 'Classic', icon: Layers },
];

/** Glass / Classic, as one segmented control. `floating` pins it to the corner of a sign-in page. */
export function LookSwitch({ floating = false, className }: { floating?: boolean; className?: string }) {
  const look = useLook();
  return (
    <div
      role="group"
      aria-label="Look of the app"
      className={cn(
        'look-switch inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 text-[11px] font-medium',
        floating && 'fixed right-4 top-4 z-40 shadow-sm',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={look === value}
          onClick={() => setLook(value)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors',
            look === value ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          <Icon size={12} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
