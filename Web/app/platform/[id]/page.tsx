'use client';

/**
 * One society as the platform team sees it: how big it is, whether it is
 * actually being used, how much of what it bills gets collected, and what
 * happened lately. Read-only — suspending stays on the societies list, behind
 * its confirmation.
 */

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Mail, Phone } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Card, Empty, Loading, Pill, StatTile } from '@/components/platform/ui';
import { formatCurrency, formatDate, formatDateTime, parseDecimalLike, roleLabel } from '@/lib/utils';

function Breakdown({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map(([key, n]) => (
        <li key={key} className="flex items-center justify-between text-sm">
          <span className="text-gray-400">{roleLabel(key.toLowerCase())}</span>
          <span className="font-medium tabular-nums text-white">{n}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PlatformSocietyPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-society-overview', id],
    queryFn: () => platformApi.overview(id).then((r) => r.data),
    enabled: !!user?.isPlatformAdmin && !!id,
    // A missing society is a 404, not a blip — retrying it just leaves the
    // spinner up for ten seconds before the same answer.
    retry: false,
  });

  const body = () => {
    if (isLoading) return <Loading />;
    if (isError || !data) {
      return (
        <Empty
          icon={Building2}
          title="Couldn't load this society"
          description="It may have been removed, or the request failed. Go back and try again."
        />
      );
    }

    const { society, flats, members, billing, accounts, recentActivity } = data;
    const billed = parseDecimalLike(billing.totalBilled);
    const collected = parseDecimalLike(billing.totalCollected);
    const collectionRate = billed > 0 ? Math.round((collected / billed) * 100) : null;

    return (
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">{society.displayName ?? society.name}</h1>
            <Pill tone={society.isActive ? 'green' : 'red'}>{society.isActive ? 'Active' : 'Suspended'}</Pill>
            {society.joinCode && (
              <code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-300">{society.joinCode}</code>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {[society.city, society.state].filter(Boolean).join(', ') || 'No location set'} · Joined{' '}
            {formatDate(society.createdAt)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Flats"
            value={flats.total}
            hint={`${society._count.buildings} building${society._count.buildings === 1 ? '' : 's'}`}
          />
          <StatTile
            label="Members"
            value={members.total}
            hint={`${members.activeLast30Days} active in last 30 days`}
            tone="blue"
          />
          <StatTile
            label="Last login"
            value={members.lastLoginAt ? formatDate(members.lastLoginAt) : 'Never'}
            hint={members.lastLoginAt ? formatDateTime(members.lastLoginAt) : 'No member has signed in'}
            tone="violet"
          />
          <StatTile
            label="Account balance"
            value={formatCurrency(accounts.totalBalance)}
            hint={`${accounts.count} account${accounts.count === 1 ? '' : 's'}`}
            tone="amber"
          />
        </div>

        <Card title="Maintenance billing">
          {billing.billsPublished === 0 ? (
            <p className="text-sm text-gray-500">No bills have been published yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <StatTile label="Billed" value={formatCurrency(billing.totalBilled)} hint={`${billing.billsPublished} bills`} />
              <StatTile
                label="Collected"
                value={formatCurrency(billing.totalCollected)}
                hint={collectionRate === null ? undefined : `${collectionRate}% of billed`}
              />
              <StatTile label="Pending" value={formatCurrency(billing.totalPending)} />
              <StatTile label="Overdue bills" value={billing.overdueBills} tone={billing.overdueBills > 0 ? 'amber' : 'teal'} />
              <StatTile
                label="Payments to review"
                value={billing.paymentsAwaitingReview}
                tone={billing.paymentsAwaitingReview > 0 ? 'amber' : 'teal'}
              />
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Admin contacts">
            {society.admins.length === 0 ? (
              <p className="text-sm text-gray-500">No admin found</p>
            ) : (
              <ul className="space-y-3">
                {society.admins.map((a) => (
                  <li key={a.id}>
                    <p className="text-sm font-medium text-gray-100">{a.firstName} {a.lastName}</p>
                    <div className="flex flex-col gap-0.5 text-xs text-gray-400">
                      {a.phone && <span className="flex items-center gap-1"><Phone size={11} /> {a.phone}</span>}
                      <span className="flex items-center gap-1"><Mail size={11} /> {a.email}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Flats by status">
            <Breakdown counts={flats.byStatus} empty="No flats added yet" />
          </Card>
          <Card title="Members by role">
            <Breakdown counts={members.byRole} empty="No active members" />
          </Card>
        </div>

        <Card title="Recent activity" bodyClassName="p-0">
          {recentActivity.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-800/70">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm">
                  <span className="text-gray-300">
                    <span className="font-medium text-white">{a.actor.firstName} {a.actor.lastName}</span>
                    {' · '}
                    {roleLabel(a.action.toLowerCase())}
                    {a.entityType ? <span className="text-gray-500"> ({a.entityType})</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  };

  return (
    <PlatformShell>
      <Link href="/platform/societies" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white">
        <ArrowLeft size={14} /> All societies
      </Link>
      {body()}
    </PlatformShell>
  );
}
