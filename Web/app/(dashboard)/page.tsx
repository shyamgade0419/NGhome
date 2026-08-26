'use client';

import { useQuery } from '@tanstack/react-query';
import {
  IndianRupee,
  TrendingUp,
  AlertCircle,
  Wallet,
  Building2,
  Users,
  Clock,
} from 'lucide-react';
import { dashboardApi, paymentsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, paymentStatusBadge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import Link from 'next/link';

export default function DashboardPage() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.getSummary().then((r) => r.data),
  });

  const { data: pendingPayments } = useQuery({
    queryKey: ['payments', 'pending'],
    queryFn: () =>
      paymentsApi
        .list({ status: 'PENDING', limit: 5 })
        .then((r) => r.data),
  });

  if (isLoading) return <PageSpinner />;

  const s = summary;

  return (
    <>
      <Header title="Dashboard" subtitle="Society financial overview" />
      <PageContainer className="space-y-6">
        {/* Pending approvals alert */}
        {s && s.pendingApprovals > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3">
            <Clock size={18} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{s.pendingApprovals} payment{s.pendingApprovals > 1 ? 's' : ''}</span> pending verification —{' '}
              <Link href="/payments?status=PENDING" className="underline font-medium">
                review now
              </Link>
            </p>
          </div>
        )}

        {/* Financial stats */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Financials
          </h2>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            <StatCard
              label="Total Billed"
              value={s ? formatCurrency(s.totalBilled) : '—'}
              icon={IndianRupee}
              iconColor="text-blue-600"
              iconBg="bg-blue-50"
            />
            <StatCard
              label="Collected"
              value={s ? formatCurrency(s.totalCollected) : '—'}
              icon={TrendingUp}
              iconColor="text-green-600"
              iconBg="bg-green-50"
            />
            <StatCard
              label="Outstanding"
              value={s ? formatCurrency(s.totalOutstanding) : '—'}
              icon={AlertCircle}
              iconColor="text-red-600"
              iconBg="bg-red-50"
            />
            <StatCard
              label="Total Expenses"
              value={s ? formatCurrency(s.totalExpenses) : '—'}
              icon={Wallet}
              iconColor="text-orange-600"
              iconBg="bg-orange-50"
            />
            <StatCard
              label="Bank Balance"
              value={s ? formatCurrency(s.accountBalance) : '—'}
              icon={IndianRupee}
              iconColor="text-primary-600"
              iconBg="bg-primary-50"
            />
            <StatCard
              label="Corpus Fund"
              value={s ? formatCurrency(s.corpusBalance) : '—'}
              icon={IndianRupee}
              iconColor="text-purple-600"
              iconBg="bg-purple-50"
            />
          </div>
        </section>

        {/* Society stats */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Society
          </h2>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            <StatCard
              label="Members"
              value={s?.members?.toString() ?? '—'}
              icon={Users}
              iconColor="text-teal-600"
              iconBg="bg-teal-50"
            />
            <StatCard
              label="Flats"
              value={s ? `${s.flats}` : '—'}
              icon={Building2}
              iconColor="text-indigo-600"
              iconBg="bg-indigo-50"
            />
          </div>
        </section>

        {/* Pending payments quick view */}
        {pendingPayments && pendingPayments.data.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending Verifications</CardTitle>
              <Link href="/payments?status=PENDING" className="text-xs font-medium text-primary-600 hover:underline">
                View all
              </Link>
            </CardHeader>
            <div className="divide-y divide-slate-100">
              {pendingPayments.data.map((p) => (
                <Link
                  key={p.id}
                  href={`/payments/${p.id}`}
                  className="flex items-center justify-between py-3 hover:bg-slate-50 px-1 rounded"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Flat {p.flat?.flatCode ?? p.flatId}
                      {p.user ? ` · ${p.user.firstName} ${p.user.lastName}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.paymentMethod.replace(/_/g, ' ')} · {formatDateTime(p.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-900">{formatCurrency(p.amount)}</span>
                    <Badge variant={paymentStatusBadge(p.status)}>
                      {p.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
