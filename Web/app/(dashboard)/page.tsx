'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IndianRupee,
  TrendingUp,
  AlertCircle,
  Wallet,
  Building2,
  Users,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { dashboardApi, paymentsApi, billingApi, reportsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, paymentStatusBadge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import Link from 'next/link';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function DashboardPage() {
  /* Load published periods to populate the month picker */
  const { data: periodsRaw } = useQuery({
    queryKey: ['published-periods'],
    queryFn: () => billingApi.listPublishedPeriods().then((r: any) => r.data ?? r),
  });
  const periods: any[] = Array.isArray(periodsRaw) ? periodsRaw : [];

  /* Default to the most recent published period; fall back to current calendar month */
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (!initialised && periods.length > 0) {
      /* periods is ordered most-recent-first by the backend */
      const latest = periods[0];
      setSelectedYear(latest.periodYear);
      setSelectedMonth(latest.periodMonth);
      setInitialised(true);
    }
  }, [periods, initialised]);

  /* Step the month picker forward / backward — constrained to periods that exist */
  const currentIndex = periods.findIndex(
    (p) => p.periodYear === selectedYear && p.periodMonth === selectedMonth,
  );
  const canGoPrev = currentIndex < periods.length - 1;
  const canGoNext = currentIndex > 0;

  function goMonth(direction: 'prev' | 'next') {
    if (direction === 'prev' && canGoPrev) {
      const p = periods[currentIndex + 1];
      setSelectedYear(p.periodYear);
      setSelectedMonth(p.periodMonth);
    }
    if (direction === 'next' && canGoNext) {
      const p = periods[currentIndex - 1];
      setSelectedYear(p.periodYear);
      setSelectedMonth(p.periodMonth);
    }
  }

  /* Collection summary for the selected month */
  const { data: collectionRaw, isLoading: collectionLoading } = useQuery({
    queryKey: ['collection-summary', selectedYear, selectedMonth],
    queryFn: () =>
      reportsApi
        .collectionSummary({ year: selectedYear, month: selectedMonth })
        .then((r: any) => r.data ?? r)
        .catch(() => null),
    enabled: !!selectedYear && !!selectedMonth,
  });
  const collection = collectionRaw?.error ? null : collectionRaw;

  /* Expense summary for the selected month */
  const { data: expenseRaw } = useQuery({
    queryKey: ['expense-summary', selectedYear, selectedMonth],
    queryFn: () => {
      const startDate = new Date(selectedYear, selectedMonth - 1, 1).toISOString().split('T')[0];
      const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0];
      return reportsApi
        .expenseSummary({ fromDate: startDate, toDate: endDate })
        .then((r: any) => r.data ?? r)
        .catch(() => null);
    },
    enabled: !!selectedYear && !!selectedMonth,
  });
  const totalExpenses = Array.isArray(expenseRaw?.categories)
    ? expenseRaw.categories.reduce((s: number, c: any) => s + parseFloat(c.total ?? 0), 0)
    : expenseRaw?.total
    ? parseFloat(expenseRaw.total)
    : 0;

  /* Society stats + account balances (not month-specific) */
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard-base'],
    queryFn: () => dashboardApi.getSummary().then((r) => r.data),
  });

  const { data: pendingPayments } = useQuery({
    queryKey: ['payments', 'pending'],
    queryFn: () => paymentsApi.list({ status: 'PENDING', limit: 5 }).then((r) => r.data),
  });

  const isLoading = summaryLoading || collectionLoading;
  if (isLoading && !summary) return <PageSpinner />;

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
              <span className="font-semibold">
                {s.pendingApprovals} payment{s.pendingApprovals > 1 ? 's' : ''}
              </span>{' '}
              pending verification —{' '}
              <Link href="/payments?status=PENDING" className="underline font-medium">
                review now
              </Link>
            </p>
          </div>
        )}

        {/* Month picker */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => goMonth('prev')}
            disabled={!canGoPrev}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex flex-wrap gap-1.5">
            {periods.map((p: any) => (
              <button
                key={p.id}
                onClick={() => { setSelectedYear(p.periodYear); setSelectedMonth(p.periodMonth); }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  p.periodYear === selectedYear && p.periodMonth === selectedMonth
                    ? 'bg-primary-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary-700'
                }`}
              >
                {MONTH_NAMES[p.periodMonth]} {p.periodYear}
              </button>
            ))}
            {periods.length === 0 && (
              <span className="text-xs text-slate-400 py-1">No published periods yet</span>
            )}
          </div>
          <button
            onClick={() => goMonth('next')}
            disabled={!canGoNext}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Financial stats */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Financials
            {collection && (
              <span className="ml-2 normal-case text-slate-400 font-normal">
                — {MONTH_NAMES[selectedMonth]} {selectedYear}
              </span>
            )}
          </h2>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            <StatCard
              label="Total Billed"
              value={collection ? formatCurrency(collection.totalBilled) : '—'}
              icon={IndianRupee}
              iconColor="text-blue-600"
              iconBg="bg-blue-50"
              href="/billing"
            />
            <StatCard
              label="Collected"
              value={collection ? formatCurrency(collection.totalCollected) : '—'}
              icon={TrendingUp}
              iconColor="text-green-600"
              iconBg="bg-green-50"
              href="/billing"
            />
            <StatCard
              label="Outstanding"
              value={collection ? formatCurrency(collection.totalPending) : '—'}
              icon={AlertCircle}
              iconColor="text-red-600"
              iconBg="bg-red-50"
              href="/payments?status=PENDING"
            />
            <StatCard
              label="Total Expenses"
              value={totalExpenses > 0 ? formatCurrency(totalExpenses) : '—'}
              icon={Wallet}
              iconColor="text-orange-600"
              iconBg="bg-orange-50"
              href="/expenses"
            />
            <StatCard
              label="Bank Balance"
              value={s ? formatCurrency(s.accountBalance) : '—'}
              icon={IndianRupee}
              iconColor="text-primary-600"
              iconBg="bg-primary-50"
              href="/accounts"
            />
            <StatCard
              label="Corpus Fund"
              value={s ? formatCurrency(s.corpusBalance) : '—'}
              icon={IndianRupee}
              iconColor="text-purple-600"
              iconBg="bg-purple-50"
              href="/accounts"
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
              href="/residents"
            />
            <StatCard
              label="Flats"
              value={s ? `${s.flats}` : '—'}
              icon={Building2}
              iconColor="text-indigo-600"
              iconBg="bg-indigo-50"
              href="/flats"
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
