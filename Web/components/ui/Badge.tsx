import { cn } from '@/lib/utils';
import { Tone, deepen, tint, tones } from '@/lib/tones';
import { HTMLAttributes } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-slate-100 text-slate-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  muted: 'bg-slate-50 text-slate-500',
};

// Success, warning and info carry the app's accent colours: a soft tint behind a dot and text in that colour, darkened.
const TONED: Partial<Record<BadgeVariant, Tone>> = { success: 'green', warning: 'amber', info: 'blue' };

export function Badge({ className, variant = 'default', children, style, ...props }: BadgeProps) {
  const tone = TONED[variant];
  const color = tone ? tones[tone] : null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        !color && variants[variant],
        className,
      )}
      style={color ? { backgroundColor: tint(color, 0.86), color: deepen(color, 0.45), ...style } : style}
      {...props}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color ?? 'currentColor' }} />
      {children}
    </span>
  );
}

export function billStatusBadge(status: string) {
  const map: Record<string, BadgeVariant> = {
    DRAFT: 'muted',
    GENERATED: 'info',
    PARTIALLY_PAID: 'warning',
    PAID: 'success',
    OVERDUE: 'danger',
    WAIVED: 'muted',
  };
  return map[status] ?? 'default';
}

export function paymentStatusBadge(status: string) {
  const map: Record<string, BadgeVariant> = {
    PENDING_VERIFICATION: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
  };
  return map[status] ?? 'default';
}

export function expenseStatusBadge(status: string) {
  const map: Record<string, BadgeVariant> = {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
  };
  return map[status] ?? 'default';
}
