'use client';

import { useQuery } from '@tanstack/react-query';
import { Wallet, Receipt, ShieldCheck, Lock } from 'lucide-react';
import { accountsApi, societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, cn } from '@/lib/utils';

interface Fund {
  id: string;
  name: string;
  description: string | null;
  currentBalance: string | number;
}

/**
 * Resident-facing financial transparency — mirrors the mobile "Society
 * Finances" screen exactly. Every figure here is gated server-side by its
 * own show*ToResidents flag (see GET /societies/my/financial-summary and
 * GET /funds' own isVisibleToResidents filter), so this page is safe to
 * show regardless of what the admin has actually turned on — there's
 * nothing here that could leak something the admin didn't intend to
 * share. Admins already have the fuller Accounts page; this is
 * deliberately not added to their nav.
 */
export default function FinancesPage() {
  const { data: funds, isLoading: fundsLoading } = useQuery({
    queryKey: ['resident-funds'],
    queryFn: () => accountsApi.listFunds({ limit: 100 }).then((r: any) => (r.data?.data ?? r.data) as Fund[]),
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['resident-financial-summary'],
    queryFn: () => societyApi.getFinancialSummary().then((r) => r.data),
  });

  const isLoading = fundsLoading || summaryLoading;
  const visibleFunds = funds ?? [];
  const showBalances = summary?.showBalances ?? false;
  const showExpenses = summary?.showExpenses ?? false;
  const nothingToShow = visibleFunds.length === 0 && !showBalances && !showExpenses;

  return (
    <>
      <Header title="Society Finances" subtitle="Corpus fund and account transparency" />
      <PageContainer className="space-y-4 max-w-2xl">
        {isLoading ? (
          <PageSpinner />
        ) : nothingToShow ? (
          <EmptyState
            icon={Lock}
            title="Not shared yet"
            description="Your society admin hasn't enabled financial transparency for residents. Ask your committee if you'd like this turned on in Society Settings."
          />
        ) : (
          <>
            {showBalances && (
              <Card padding="lg" className="space-y-1">
                <div className="flex items-center gap-2 text-primary-600">
                  <Wallet size={18} />
                  <p className="text-sm font-semibold text-slate-900">Total Account Balance</p>
                </div>
                <p className="text-2xl font-bold text-primary-700">{formatCurrency(summary?.totalBalance ?? 0)}</p>
                <p className="text-xs text-slate-400">Across all active society accounts</p>
              </Card>
            )}

            {showExpenses && (
              <Card padding="lg" className="space-y-1">
                <div className="flex items-center gap-2 text-red-600">
                  <Receipt size={18} />
                  <p className="text-sm font-semibold text-slate-900">Expenses This Month</p>
                </div>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(summary?.monthlyExpenses ?? 0)}</p>
                <p className="text-xs text-slate-400">Approved/paid expenses and processed staff salaries, month to date</p>

                {(summary?.byCategory?.length ?? 0) > 0 && (
                  <div className="mt-3 space-y-2.5">
                    {summary!.byCategory!.map((c) => {
                      const max = Math.max(...summary!.byCategory!.map((x) => x.total));
                      return (
                        <div key={c.category} className="space-y-1">
                          <div className="flex items-baseline justify-between text-sm">
                            <span className="font-medium text-slate-700">{c.category}</span>
                            <span className="font-bold text-slate-900">{formatCurrency(c.total)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn('h-full rounded-full', c.category === 'Staff Salaries' ? 'bg-green-600' : 'bg-primary-600')}
                              style={{ width: max > 0 ? `${(c.total / max) * 100}%` : '0%' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            )}

            {visibleFunds.length > 0 && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 pt-2">Funds</p>
                {visibleFunds.map((f) => (
                  <Card key={f.id} padding="lg" className="space-y-1">
                    <div className="flex items-center gap-2 text-green-600">
                      <ShieldCheck size={18} />
                      <p className="text-sm font-semibold text-slate-900">{f.name}</p>
                    </div>
                    <p className="text-2xl font-bold text-green-700">{formatCurrency(f.currentBalance)}</p>
                    {f.description && <p className="text-xs text-slate-400">{f.description}</p>}
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </PageContainer>
    </>
  );
}
