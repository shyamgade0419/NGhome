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
}

export function StatCard({ label, value, icon: Icon, iconColor = 'text-primary-600', iconBg = 'bg-primary-50', sub, trend, href, tone, progress }: StatCardProps) {
  const color = tone ? tones[tone] : null;
  // The icon sits beside the label and the figure gets the whole width below it: on a phone two cards share one row, and a
  // figure like ₹71,820.04 beside an icon ran underneath it.
  const inner = (
    <div>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {color ? (
          <div className="shrink-0 rounded-xl p-2 text-white" style={{ backgroundColor: color }}>
            <Icon size={18} />
          </div>
        ) : (
          <div className={cn('shrink-0 rounded-lg p-2', iconBg)}>
            <Icon size={18} className={iconColor} />
          </div>
        )}
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">{value}</p>
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
  const base = color ? 'rounded-2xl border p-4 sm:p-5' : 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5';

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
