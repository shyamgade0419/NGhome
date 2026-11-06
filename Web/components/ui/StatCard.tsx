import { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Tone, tint, tones } from '@/lib/tones';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  sub?: string;
  trend?: { value: string; positive: boolean };
  href?: string;
  /** Puts the card on a soft background of this colour, with a solid icon chip: the colour says what kind of figure it is. */
  tone?: Tone;
  /** 0 to 1: draws a thin progress bar under the figure (with `tone`). */
  progress?: number;
  /** Makes the card a button instead of a link, e.g. to show only that status. */
  onClick?: () => void;
  /** Marks the card as the one in use, when it is a filter. */
  selected?: boolean;
  /** For three cards in a row: on a phone the icon is left out, so a long label like "Approved" has the whole width. */
  compact?: boolean;
}

export function StatCard({ label, value, icon: Icon, iconColor = 'text-primary-600', iconBg = 'bg-primary-50', sub, trend, href, tone, progress, onClick, selected, compact }: StatCardProps) {
  const color = tone ? tones[tone] : null;
  // The icon sits beside the label and the figure gets the whole width below it: on a phone two cards share one row, and a
  // figure like ₹71,820.04 beside an icon ran underneath it.
  const inner = (
    <div>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-normal text-slate-500 sm:text-xs sm:tracking-wide">{label}</p>
        {color ? (
          <div className={cn('shrink-0 rounded-lg p-1.5 text-white sm:rounded-xl sm:p-2', compact && 'hidden sm:block')} style={{ backgroundColor: color }}>
            <Icon size={18} className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
          </div>
        ) : (
          <div className={cn('shrink-0 rounded-lg p-1.5 sm:p-2', compact && 'hidden sm:block', iconBg)}>
            <Icon size={18} className={cn('h-4 w-4 sm:h-[18px] sm:w-[18px]', iconColor)} />
          </div>
        )}
      </div>
      <p className="mt-1 font-display text-xl font-extrabold tabular-nums text-slate-900 sm:text-2xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {trend && (
        <p className={cn('mt-1 text-xs font-medium', trend.positive ? 'text-green-600' : 'text-red-600')}>
          {trend.positive ? '↑' : '↓'} {trend.value}
        </p>
      )}
      {color && progress !== undefined && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: tint(color, 0.78) }}>
          <div className="h-full rounded-full" style={{ backgroundColor: color, width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} />
        </div>
      )}
    </div>
  );

  const toned = color ? { backgroundColor: tint(color, 0.9), borderColor: tint(color, 0.76) } : undefined;
  const base = color ? 'rounded-2xl border p-3 sm:p-5' : 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5';

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={selected} className={cn('block w-full text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', base, selected && 'ring-2 ring-primary-500')} style={toned}>
        {inner}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} className={cn('block transition-shadow hover:shadow-md', base, !color && 'hover:border-primary-200')} style={toned}>
        {inner}
      </Link>
    );
  }

  return (
    <div className={base} style={toned}>
      {inner}
    </div>
  );
}
