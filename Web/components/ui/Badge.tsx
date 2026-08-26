import { cn } from '@/lib/utils';
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

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    >
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
