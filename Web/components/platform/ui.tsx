'use client';

/**
 * Small dark-theme building blocks for the platform console. The society app's
 * shared components (Table, Badge, Button, Modal) are light-themed, and the
 * console is a separate surface for the NovaGade team, so it has its own.
 */

import { ButtonHTMLAttributes, ReactNode, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({
  title,
  icon: Icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-gray-800 bg-gray-900/70', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-gray-800 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            {Icon && <Icon size={15} className="text-teal-400" />}
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'teal',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'teal' | 'blue' | 'violet' | 'amber' | 'red';
}) {
  const tones = {
    teal: 'bg-teal-500/15 text-teal-400',
    blue: 'bg-blue-500/15 text-blue-400',
    violet: 'bg-violet-500/15 text-violet-400',
    amber: 'bg-amber-500/15 text-amber-400',
    red: 'bg-red-500/15 text-red-400',
  };
  return (
    <div className="flex items-start justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-5 py-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        <p className="mt-2 text-3xl font-bold tabular-nums text-white">{value}</p>
        {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      </div>
      {Icon && (
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', tones[tone])}>
          <Icon size={18} />
        </span>
      )}
    </div>
  );
}

const PILL_TONES = {
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  red: 'bg-red-500/15 text-red-300 ring-red-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  blue: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  slate: 'bg-gray-500/15 text-gray-300 ring-gray-500/30',
};

export function Pill({ tone = 'slate', children }: { tone?: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        PILL_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

interface DButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function DButton({ variant = 'outline', size = 'md', loading, className, children, disabled, ...rest }: DButtonProps) {
  const variants = {
    primary: 'bg-teal-500 text-gray-950 hover:bg-teal-400',
    outline: 'border border-gray-700 text-gray-200 hover:bg-gray-800',
    danger: 'bg-red-500 text-white hover:bg-red-400',
  };
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/70">{children}</div>;
}

export function DTable({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-gray-800 text-[11px] uppercase tracking-wider text-gray-400">
          {head.map((h, i) => (
            <th key={i} className="whitespace-nowrap px-4 py-3 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-800/70">{children}</tbody>
    </table>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 align-top text-gray-200', className)}>{children}</td>;
}

export function Empty({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 px-6 py-14 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gray-800 text-gray-400">
        <Icon size={20} />
      </span>
      <p className="font-semibold text-gray-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-gray-500">
      <Loader2 size={22} className="animate-spin" />
    </div>
  );
}

export function DModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}
