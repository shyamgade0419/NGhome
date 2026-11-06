'use client';

import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { areaForPath } from '@/lib/areas';
import { tint, tones } from '@/lib/tones';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  // A form wears the colour of the page it was opened from: one from Payments is green, one from Billing blue.
  const area = areaForPath(usePathname());
  const AreaIcon = area?.icon;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative w-full rounded-2xl bg-white shadow-xl motion-safe:animate-fade-up',
          sizes[size],
        )}
      >
        <div
          className="flex items-center gap-3 rounded-t-2xl border-b px-6 py-4"
          style={{ backgroundColor: area ? tint(tones[area.tone], 0.94) : undefined, borderBottomColor: area ? tint(tones[area.tone], 0.55) : '#E8DFCD', borderBottomWidth: area ? 2 : 1 }}
        >
          {area && AreaIcon && (
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: tones[area.tone] }} aria-hidden="true">
              <AreaIcon size={16} />
            </span>
          )}
          <h2 className="flex-1 font-display text-lg font-bold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
