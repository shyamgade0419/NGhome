import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export function Spinner({ className, size = 20 }: { className?: string; size?: number }) {
  return <Loader2 size={size} className={cn('animate-spin text-primary-600', className)} />;
}

export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner size={32} />
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <Spinner size={36} />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    </div>
  );
}
