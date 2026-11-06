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
  Receipt,
  LayoutGrid,
  CheckCircle2,
  PlusCircle,
  Droplets,
  Wrench,
  Megaphone,
  CalendarDays,
  BarChart3,
  Landmark,
  PieChart,
  FolderOpen,
  Bell,
} from 'lucide-react';
import { dashboardApi, paymentsApi, billingApi, reportsApi, communityApi, meetingsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { StatCard } from '@/components/ui/StatCard';
import { HeroCard } from '@/components/home/HeroCard';
import { ProgressRing } from '@/components/home/ProgressRing';
import { UpdatesStrip, UpdateItem } from '@/components/home/UpdatesStrip';
import { QuickActions, QuickAction } from '@/components/home/QuickActions';
import { Reveal } from '@/components/home/Reveal';
import { CountUpNumber } from '@/components/home/CountUpNumber';
import { DashboardSkeleton } from '@/components/home/DashboardSkeleton';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, paymentStatusBadge } from '@/components/ui/Badge';
import { formatCurrency, formatDateTime, parseDecimalLike } from '@/lib/utils';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';
import { can } from '@/lib/permissions';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MANAGER_ACTIONS: readonly QuickAction[] = [
  { label: 'Billing', href: '/billing', icon: Receipt, tone: 'blue' },
  { label: 'Maintenance Sheet', href: '/billing/statement', icon: LayoutGrid, tone: 'teal' },
  { label: 'Verify Payments', href: '/payments?status=PENDING', icon: CheckCircle2, tone: 'green' },
  { label: 'Add Expense', href: '/expenses', icon: PlusCircle, tone: 'coral' },
  { label: 'Water', href: '/water', icon: Droplets, tone: 'teal' },
  { label: 'Helpdesk', href: '/helpdesk', icon: Wrench, tone: 'amber' },
  { label: 'Community', href: '/community', icon: Megaphone, tone: 'violet' },
  { label: 'Meetings', href: '/meetings', icon: CalendarDays, tone: 'teal' },
  { label: 'Residents', href: '/residents', icon: Users, tone: 'blue' },
  { label: 'Reports', href: '/reports', icon: BarChart3, tone: 'green' },
  { label: 'Accounts', href: '/accounts', icon: Landmark, tone: 'violet' },
];

const RESIDENT_ACTIONS: readonly QuickAction[] = [
  { label: 'My Bills', href: '/billing/my', icon: Receipt, tone: 'blue' },
  { label: 'Maintenance Sheet', href: '/billing/statement', icon: LayoutGrid, tone: 'teal' },
  { label: 'Society Finances', href: '/finances', icon: PieChart, tone: 'green' },
  { label: 'Meetings', href: '/meetings', icon: CalendarDays, tone: 'teal' },
  { label: 'Community', href: '/community', icon: Megaphone, tone: 'violet' },
  { label: 'Helpdesk', href: '/helpdesk', icon: Wrench, tone: 'amber' },
  { label: 'Documents', href: '/documents', icon: FolderOpen, tone: 'blue' },
  { label: 'Notifications', href: '/notifications', icon: Bell, tone: 'coral' },
];

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

export default function DashboardPage() {
  const { user, activeMembership } = useAuth();
  // The bank balance and the corpus are the finance team's figures. A resident (an owner sees them on the
  // Society Finances page if the society allows; a tenant never does) gets no tile at all, not a misleading zero.
  const showMoneyTiles = can.manageBilling(activeMembership?.role, user?.isPlatformAdmin);
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
      // Built from the parts: toISOString() on local midnight lands on the day before for anyone east of UTC (India).
      const pad = (n: number) => String(n).padStart(2, '0');
      const startDate = `${selectedYear}-${pad(selectedMonth)}-01`;
      const endDate = `${selectedYear}-${pad(selectedMonth)}-${pad(new Date(selectedYear, selectedMonth, 0).getDate())}`;
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

  // What is happening, for the swipe strip. Each is optional: a request that fails just leaves its card out.
  const { data: announcementsRaw } = useQuery({
    queryKey: ['home-announcements'],
    queryFn: () => communityApi.listAnnouncements({ limit: 3 }).then((r: any) => r.data ?? r).catch(() => null),
    staleTime: 60_000,
  });
  const { data: meetingsRaw } = useQuery({
    queryKey: ['home-meetings'],
    queryFn: () => meetingsApi.list().then((r: any) => r.data ?? r).catch(() => null),
    staleTime: 60_000,
  });
  // A resident's hero card is their own bill, not the society's collection.
  const { data: myBillsRaw } = useQuery({
    queryKey: ['home-my-bills'],
    queryFn: () => billingApi.getMyBills({ limit: 5 }).then((r: any) => r.data ?? r).catch(() => null),
    enabled: !showMoneyTiles,
    staleTime: 60_000,
  });

  const isLoading = summaryLoading || collectionLoading;
  if (isLoading && !summary) {
    return (
      <>
        <Header title="Dashboard" subtitle="Society financial overview" />
        <PageContainer>
          <DashboardSkeleton />
        </PageContainer>
      </>
    );
  }

  const s = summary;

  const billed = parseDecimalLike(collection?.totalBilled);
  const collected = parseDecimalLike(collection?.totalCollected);
  const collectedFraction = billed > 0 ? collected / billed : 0;
  const pendingCount = s?.pendingApprovals ?? 0;

  const myBills: any[] = Array.isArray(myBillsRaw) ? myBillsRaw : (myBillsRaw?.data ?? []);
  const myBill = myBills.find((b) => b.isPublished && !b.isPaid) ?? myBills[0] ?? null;
  const myTotal = parseDecimalLike(myBill?.totalAmount);
  const myPaid = parseDecimalLike(myBill?.paidAmount);
  const myPaidFraction = myTotal > 0 ? myPaid / myTotal : 0;
  const myOutstanding = parseDecimalLike(myBill?.pendingAmount);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const announcements: any[] = Array.isArray(announcementsRaw) ? announcementsRaw : (announcementsRaw?.data ?? []);
  const meetings: any[] = Array.isArray(meetingsRaw) ? meetingsRaw : (meetingsRaw?.data ?? []);
  const nextMeeting = meetings
    .filter((m) => m.meetingDate && new Date(m.meetingDate) >= startOfToday)
    .sort((a, b) => +new Date(a.meetingDate) - +new Date(b.meetingDate))[0];

  const real: UpdateItem[] = [
    ...(showMoneyTiles && pendingCount > 0
      ? [{
          id: 'approvals',
          tone: 'amber' as const,
          icon: Clock,
          title: `${pendingCount} payment${pendingCount > 1 ? 's' : ''} pending approval`,
          subtitle: 'Check the amount and approve it.',
          cta: 'Review now',
          href: '/payments?status=PENDING',
        }]
      : []),
    ...(!showMoneyTiles && myBill && !myBill.isPaid
      ? [{
          id: 'bill',
          tone: 'amber' as const,
          icon: Wallet,
          title: 'Your maintenance bill is due',
          subtitle: `${formatCurrency(myOutstanding)} by ${shortDate(myBill.dueDate)}`,
          cta: 'See my bills',
          href: '/billing/my',
        }]
      : []),
    ...announcements.slice(0, 3).map((a: any) => ({
      id: `a-${a.id}`,
      tone: a.priority === 'URGENT' || a.priority === 'HIGH' ? ('coral' as const) : ('violet' as const),
      icon: Megaphone,
      title: a.title as string,
      subtitle: a.content as string,
      cta: 'Community',
      href: '/community',
    })),
    ...(nextMeeting
      ? [{
          id: `m-${nextMeeting.id}`,
          tone: 'teal' as const,
          icon: CalendarDays,
          title: nextMeeting.title as string,
          subtitle: `Meeting on ${shortDate(nextMeeting.meetingDate)}${nextMeeting.location ? `, ${nextMeeting.location}` : ''}`,
          cta: 'Meetings',
          href: '/meetings',
        }]
      : []),
  ];

  // A society with nothing posted yet would otherwise have no strip at all. For whatever is missing, a card offers the
  // next thing this person can do, so the strip is always there.
  const tips: UpdateItem[] = showMoneyTiles
    ? [
        ...(announcements.length === 0 ? [{ id: 'tip-announce', tone: 'violet' as const, icon: Megaphone, title: 'Tell your residents something', subtitle: 'Post a notice and everyone sees it in the app.', cta: 'Post an announcement', href: '/community' }] : []),
        ...(!nextMeeting ? [{ id: 'tip-meeting', tone: 'teal' as const, icon: CalendarDays, title: 'Plan a meeting', subtitle: 'Set the date and agenda, and residents are told.', cta: 'Schedule a meeting', href: '/meetings' }] : []),
        { id: 'tip-invite', tone: 'green' as const, icon: Users, title: 'Invite residents', subtitle: "Share your society's join code so residents can sign up.", cta: 'Open settings', href: '/settings' },
      ]
    : [
        { id: 'tip-helpdesk', tone: 'amber' as const, icon: Wrench, title: 'Need something fixed?', subtitle: 'Raise a request and follow it until it is done.', cta: 'Open the helpdesk', href: '/helpdesk' },
        { id: 'tip-visitors', tone: 'coral' as const, icon: Users, title: 'Expecting a guest?', subtitle: 'Invite them in advance and the gate lets them in.', cta: 'Open visitors', href: '/visitors' },
        { id: 'tip-community', tone: 'violet' as const, icon: Megaphone, title: 'Meet your neighbours', subtitle: 'Ask, share and chat on the community board.', cta: 'Open the board', href: '/community' },
      ];
  const updates: UpdateItem[] = real.length >= 3 ? real : [...real, ...tips.slice(0, 3 - real.length)];

  const periodStatus = collection?.period?.status ?? (periods[currentIndex]?.status as string | undefined) ?? 'PUBLISHED';

  return (
    <>
      <Header title="Dashboard" subtitle="Society financial overview" />
      <PageContainer className="space-y-6">
        {/* Month picker */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => goMonth('prev')}
            disabled={!canGoPrev}
            aria-label="Earlier billing period"
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
            aria-label="Later billing period"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Hero: for the finance team, what is still to collect and how much is in; for a resident, their own bill. */}
        <Reveal>
        {showMoneyTiles ? (
          <HeroCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-white/80">{currentIndex <= 0 ? 'Current billing period' : 'Billing period'}</p>
                <p className="text-lg font-bold">{MONTH_NAMES[selectedMonth]} {selectedYear}</p>
              </div>
              <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide">{periodStatus}</span>
            </div>
            <p className="mt-4 font-display text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl">
              <CountUpNumber value={collection ? parseDecimalLike(collection.totalPending) : null} format={formatCurrency} />
              <span className="ml-2 text-base font-semibold text-white/80 sm:text-lg">pending</span>
            </p>
            <p className="text-sm text-white/85">of {collection ? formatCurrency(collection.totalBilled) : '—'} billed this month</p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <ProgressRing fraction={collectedFraction} label={`${Math.round(collectedFraction * 100)}%`} title={`${Math.round(collectedFraction * 100)} percent collected`} />
              <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-sm">
                <div className="rounded-2xl bg-white/15 px-3 py-2">
                  <p className="text-lg font-extrabold tabular-nums">{collection ? formatCurrency(collection.totalCollected) : '—'}</p>
                  <p className="text-xs text-white/85">collected</p>
                </div>
                <Link href="/payments?status=PENDING" className="rounded-2xl bg-white/15 px-3 py-2 hover:bg-white/25">
                  <p className="text-lg font-extrabold tabular-nums">{pendingCount}</p>
                  <p className="text-xs text-white/85">to review</p>
                </Link>
              </div>
            </div>
          </HeroCard>
        ) : (
          <HeroCard>
            {myBill ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-white/80">Your maintenance</p>
                    <p className="text-lg font-bold">Flat {myBill.flatCode}</p>
                  </div>
                  <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide">{myBill.isPaid ? 'Paid' : 'Pending'}</span>
                </div>
                <p className="mt-4 font-display text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl">
                  <CountUpNumber value={myTotal} format={formatCurrency} />
                </p>
                {!myBill.isPaid && (
                  <p className="text-sm text-white/85">
                    Outstanding {formatCurrency(myOutstanding)} · due {shortDate(myBill.dueDate)}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap items-center gap-4">
                  <ProgressRing fraction={myPaidFraction} label={`${Math.round(myPaidFraction * 100)}%`} title={`${Math.round(myPaidFraction * 100)} percent of this bill paid`} />
                  <Link href="/billing/my" className="rounded-xl bg-white/20 px-4 py-2.5 text-sm font-bold hover:bg-white/30">
                    {myBill.isPaid ? 'See my bills' : 'Pay or upload payment'}
                  </Link>
                </div>
              </>
            ) : (
              <p className="py-2 text-base font-semibold">No pending bill. You are all caught up!</p>
            )}
          </HeroCard>
        )}
        </Reveal>

        {/* What is happening: swipe, or use the arrows */}
        {updates.length > 0 && (
          <Reveal delay={90}>
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">What&apos;s happening</h2>
              <UpdatesStrip items={updates} />
            </section>
          </Reveal>
        )}

        {/* Financial stats. A resident the server shows no collection figures to gets no row of dashes. */}
        {(showMoneyTiles || collection) && (
        <Reveal delay={180}>
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Financials
            {collection && (
              <span className="ml-2 normal-case text-slate-400 font-normal">
                — {MONTH_NAMES[selectedMonth]} {selectedYear}
              </span>
            )}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            <StatCard
              label="Total Billed"
              value={collection ? formatCurrency(collection.totalBilled) : '—'}
              icon={IndianRupee}
              tone="blue"
              href="/billing"
            />
            <StatCard
              label="Collected"
              value={collection ? formatCurrency(collection.totalCollected) : '—'}
              icon={TrendingUp}
              tone="green"
              progress={collectedFraction}
              href="/billing"
            />
            <StatCard
              label="Outstanding"
              value={collection ? formatCurrency(collection.totalPending) : '—'}
              icon={AlertCircle}
              tone="amber"
              href="/payments?status=PENDING"
            />
            <StatCard
              label="Total Expenses"
              value={totalExpenses > 0 ? formatCurrency(totalExpenses) : '—'}
              icon={Wallet}
              tone="coral"
              href="/expenses"
            />
            {showMoneyTiles && (
            <StatCard
              label="Bank Balance"
              value={s ? formatCurrency(s.accountBalance) : '—'}
              icon={Landmark}
              tone="blue"
              href="/accounts"
            />
            )}
            {showMoneyTiles && (
            <StatCard
              label="Corpus Fund"
              value={s ? formatCurrency(s.corpusBalance) : '—'}
              icon={IndianRupee}
              tone="violet"
              href="/accounts"
            />
            )}
          </div>
        </section>
        </Reveal>
        )}

        {/* Society stats */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Society
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            <StatCard
              label="Members"
              value={s?.members?.toString() ?? '—'}
              icon={Users}
              tone="teal"
              href="/residents"
            />
            <StatCard
              label="Flats"
              value={s ? `${s.flats}` : '—'}
              icon={Building2}
              tone="violet"
              href="/flats"
            />
          </div>
        </section>

        {/* Quick actions */}
        <Reveal delay={270}>
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Quick actions</h2>
            <QuickActions items={showMoneyTiles ? MANAGER_ACTIONS : RESIDENT_ACTIONS} />
          </section>
        </Reveal>

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
