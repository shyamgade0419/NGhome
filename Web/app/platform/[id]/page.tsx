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
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { formatCurrency, formatDate, formatDateTime, parseDecimalLike, roleLabel } from '@/lib/utils';

function Metric({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone === 'warn' ? 'text-amber-600' : 'text-slate-900'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Breakdown({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map(([key, n]) => (
        <li key={key} className="flex items-center justify-between text-sm">
          <span className="text-slate-600">{roleLabel(key.toLowerCase())}</span>
          <span className="font-medium tabular-nums text-slate-900">{n}</span>
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
    if (isLoading) return <PageSpinner />;
    if (isError || !data) {
      return (
        <EmptyState
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
            <h2 className="text-xl font-bold text-slate-900">{society.displayName ?? society.name}</h2>
            <Badge variant={society.isActive ? 'success' : 'danger'}>{society.isActive ? 'Active' : 'Suspended'}</Badge>
            {society.joinCode && (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">{society.joinCode}</code>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {[society.city, society.state].filter(Boolean).join(', ') || 'No location set'}
            {' · '}Joined {formatDate(society.createdAt)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Flats" value={flats.total} hint={`${society._count.buildings} building${society._count.buildings === 1 ? '' : 's'}`} />
          <Metric label="Members" value={members.total} hint={`${members.activeLast30Days} active in last 30 days`} />
          <Metric
            label="Last login"
            value={members.lastLoginAt ? formatDate(members.lastLoginAt) : 'Never'}
            hint={members.lastLoginAt ? formatDateTime(members.lastLoginAt) : 'No member has signed in'}
          />
          <Metric label="Account balance" value={formatCurrency(accounts.totalBalance)} hint={`${accounts.count} account${accounts.count === 1 ? '' : 's'}`} />
        </div>

        <Section title="Maintenance billing">
          {billing.billsPublished === 0 ? (
            <p className="text-sm text-slate-400">No bills have been published yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Metric label="Billed" value={formatCurrency(billing.totalBilled)} hint={`${billing.billsPublished} bills`} />
              <Metric
                label="Collected"
                value={formatCurrency(billing.totalCollected)}
                hint={collectionRate === null ? undefined : `${collectionRate}% of billed`}
              />
              <Metric label="Pending" value={formatCurrency(billing.totalPending)} />
              <Metric
                label="Overdue bills"
                value={billing.overdueBills}
                tone={billing.overdueBills > 0 ? 'warn' : undefined}
              />
              <Metric
                label="Payments to review"
                value={billing.paymentsAwaitingReview}
                tone={billing.paymentsAwaitingReview > 0 ? 'warn' : undefined}
              />
            </div>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Admin contacts">
            {society.admins.length === 0 ? (
              <p className="text-sm text-slate-400">No admin found</p>
            ) : (
              <ul className="space-y-3">
                {society.admins.map((a) => (
                  <li key={a.id}>
                    <p className="text-sm font-medium text-slate-800">{a.firstName} {a.lastName}</p>
                    <div className="flex flex-col gap-0.5 text-xs text-slate-500">
                      {a.phone && <span className="flex items-center gap-1"><Phone size={11} /> {a.phone}</span>}
                      <span className="flex items-center gap-1"><Mail size={11} /> {a.email}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Flats by status">
            <Breakdown counts={flats.byStatus} empty="No flats added yet" />
          </Section>

          <Section title="Members by role">
            <Breakdown counts={members.byRole} empty="No active members" />
          </Section>
        </div>

        <Section title="Recent activity">
          {recentActivity.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="text-slate-700">
                    <span className="font-medium text-slate-900">{a.actor.firstName} {a.actor.lastName}</span>
                    {' · '}
                    {roleLabel(a.action.toLowerCase())}
                    {a.entityType ? <span className="text-slate-400"> ({a.entityType})</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    );
  };

  return (
    <PlatformShell>
      <Link href="/platform" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> All societies
      </Link>
      {body()}
    </PlatformShell>
  );
}
