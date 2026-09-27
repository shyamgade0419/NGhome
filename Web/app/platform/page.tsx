'use client';

/**
 * Platform console dashboard. Not part of the (dashboard) layout group
 * deliberately: that layout assumes a society context (a societyId claim on
 * the token), which a platform-admin session never has. Every request here
 * hits PlatformAdminGuard-protected routes, so a non-admin who lands on the
 * URL gets nothing back from the API even before PlatformShell redirects them.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, Home, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Card, Empty, Loading, PageHeader, Pill, StatTile } from '@/components/platform/ui';
import { formatDate } from '@/lib/utils';

export default function PlatformDashboard() {
  const { user } = useAuth();
  const enabled = !!user?.isPlatformAdmin;

  const { data: stats } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => platformApi.stats().then((r) => r.data),
    enabled,
  });
  const { data: list, isLoading } = useQuery({
    queryKey: ['platform-societies'],
    queryFn: () => platformApi.listSocieties({ limit: 100 }).then((r) => r.data),
    enabled,
  });

  const recent = (list?.data ?? []).slice(0, 8);
  const activePct = stats && stats.societies > 0 ? Math.round((stats.activeSocieties / stats.societies) * 100) : 0;

  return (
    <PlatformShell>
      <PageHeader title="Platform Overview" subtitle="All societies across the NG Home platform" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total societies"
          value={stats?.societies ?? '—'}
          hint={stats ? `+${stats.newThisMonth} this month` : undefined}
          icon={Building2}
        />
        <StatTile
          label="Active"
          value={stats?.activeSocieties ?? '—'}
          hint={stats ? `${stats.suspendedSocieties} suspended` : undefined}
          icon={ShieldCheck}
          tone="blue"
        />
        <StatTile
          label="Flats"
          value={stats?.flats ?? '—'}
          hint={stats ? `${stats.buildings} buildings` : undefined}
          icon={Home}
          tone="violet"
        />
        <StatTile
          label="Members"
          value={stats?.members ?? '—'}
          hint={stats ? `${stats.admins} society admins` : undefined}
          icon={Users}
          tone="amber"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Society status" icon={TrendingUp} className="lg:col-span-2">
          {!stats ? (
            <Loading />
          ) : stats.societies === 0 ? (
            <p className="text-sm text-gray-500">No societies yet.</p>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-gray-300">Active</span>
                  <span className="tabular-nums text-gray-400">
                    {stats.activeSocieties} ({activePct}%)
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                  <div className="h-full rounded-full bg-teal-400" style={{ width: `${activePct}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-gray-300">Suspended</span>
                  <span className="tabular-nums text-gray-400">
                    {stats.suspendedSocieties} ({100 - activePct}%)
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${100 - activePct}%` }} />
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Recent signups"
          icon={Building2}
          className="lg:col-span-3"
          bodyClassName="p-0"
          action={
            <Link href="/platform/societies" className="text-xs font-medium text-teal-400 hover:text-teal-300">
              View all →
            </Link>
          }
        >
          {isLoading ? (
            <Loading />
          ) : recent.length === 0 ? (
            <div className="p-5">
              <Empty icon={Building2} title="No societies yet" description="Societies appear here once they register." />
            </div>
          ) : (
            <ul className="divide-y divide-gray-800/70">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/platform/${s.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gray-800/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-sm font-bold text-gray-300">
                        {(s.displayName ?? s.name)[0]?.toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{s.displayName ?? s.name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {[s.city, s.state].filter(Boolean).join(', ') || 'No location'} · joined {formatDate(s.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Pill tone={s.isActive ? 'green' : 'red'}>{s.isActive ? 'active' : 'suspended'}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PlatformShell>
  );
}
