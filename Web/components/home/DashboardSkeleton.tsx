/** The dashboard's shape in grey while it loads: a hero card, a strip and a grid of tiles. */
export function DashboardSkeleton() {
  const block = 'animate-pulse rounded-2xl bg-slate-200';
  return (
    <div className="space-y-6" role="status" aria-label="Loading the dashboard">
      <div className={`${block} h-8 w-72 rounded-lg`} />
      <div className={`${block} h-48 rounded-3xl`} />
      <div className={`${block} h-24`} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${block} h-28`} />
        ))}
      </div>
    </div>
  );
}
