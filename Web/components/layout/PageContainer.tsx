import { cn } from '@/lib/utils';

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn('flex-1 overflow-y-auto p-6 scrollbar-thin', className)}>
      {children}
    </main>
  );
}
