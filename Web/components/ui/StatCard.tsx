import { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  sub?: string;
  trend?: { value: string; positive: boolean };
  href?: string;
}

export function StatCard({ label, value, icon: Icon, iconColor = 'text-primary-600', iconBg = 'bg-primary-50', sub, trend, href }: StatCardProps) {
  const inner = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1.5 text-2xl font-bold text-slate-900">{value}</p>
        {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
        {trend && (
          <p className={cn('mt-1 text-xs font-medium', trend.positive ? 'text-green-600' : 'text-red-600')}>
            {trend.positive ? '↑' : '↓'} {trend.value}
          </p>
        )}
      </div>
      <div className={cn('rounded-lg p-2.5', iconBg)}>
        <Icon size={20} className={iconColor} />
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md hover:border-primary-200">
        {inner}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {inner}
    </div>
  );
}
