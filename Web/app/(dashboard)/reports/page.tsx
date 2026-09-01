'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate } from '@/lib/utils';

const tabs = ['Outstanding Dues', 'Collection Summary', 'Expense Summary', 'Account Balances'];

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => {
  const y = currentYear - i;
  return { value: String(y), label: String(y) };
});

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState(0);

  // Outstanding dues & expense summary — date range
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Collection summary — billing period month/year
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));

  /* ── Queries ─────────────────────────────────────────────── */

  const { data: outstanding, isLoading: l1 } = useQuery({
    queryKey: ['report-outstanding'],
    queryFn: () => reportsApi.outstandingDues().then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: collection, isLoading: l2 } = useQuery({
    queryKey: ['report-collection', year, month],
    queryFn: () =>
      reportsApi.collectionSummary({ year: Number(year), month: Number(month) }).then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: expenseSummary, isLoading: l3 } = useQuery({
    queryKey: ['report-expenses', fromDate, toDate],
    queryFn: () =>
      reportsApi
        .expenseSummary({ fromDate: fromDate || undefined, toDate: toDate || undefined })
        .then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: balances, isLoading: l4 } = useQuery({
    queryKey: ['report-balances'],
    queryFn: () => reportsApi.accountBalances().then((r) => r.data),
    enabled: activeTab === 3,
  });

  const isLoading = [l1, l2, l3, l4][activeTab];

  return (
    <>
      <Header title="Reports" subtitle="Financial reports & analytics" />
      <PageContainer className="space-y-6">
        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 overflow-x-auto">
          {tabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`flex-shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === i
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Filters — different per tab */}
        {activeTab === 1 && (
          <div className="flex gap-3 items-end">
            <Select
              label="Month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              options={MONTHS}
              className="w-44"
            />
            <Select
              label="Year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              options={YEARS}
              className="w-32"
            />
          </div>
        )}
        {(activeTab === 2) && (
          <div className="flex gap-3">
            <Input
              label="From"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-44"
            />
            <Input
              label="To"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-44"
            />
          </div>
        )}

        {isLoading && <PageSpinner />}

        {/* ── Outstanding dues ─────────────────────────────── */}
        {activeTab === 0 && outstanding && (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900">
                Total Outstanding:{' '}
                <span className="text-red-600">
                  {formatCurrency(outstanding.totalOutstanding ?? 0)}
                </span>
              </p>
            </div>
            {(outstanding.bills ?? []).length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                🎉 No outstanding dues — all bills are paid!
              </div>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Invoice #</Th>
                    <Th>Flat</Th>
                    <Th>Resident</Th>
                    <Th>Due Date</Th>
                    <Th>Total</Th>
                    <Th>Outstanding</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(outstanding.bills ?? []).map((b: any) => (
                    <Tr key={b.id}>
                      <Td className="font-mono text-xs">{b.invoiceNumber ?? b.id?.slice(0, 8)}</Td>
                      <Td className="font-semibold">{b.flat?.flatCode ?? b.flatCode}</Td>
                      <Td className="text-slate-500">{b.residentName ?? '—'}</Td>
                      <Td>{formatDate(b.dueDate)}</Td>
                      <Td className="tabular-nums">{formatCurrency(b.totalAmount)}</Td>
                      <Td className="font-semibold text-red-600 tabular-nums">
                        {formatCurrency(b.pendingAmount)}
                      </Td>
                      <Td>
                        <Badge variant={b.isPaid ? 'success' : b.isPublished ? 'warning' : 'muted'}>
                          {b.isPaid ? 'Paid' : b.isPublished ? 'Unpaid' : 'Draft'}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        )}

        {/* ── Collection summary ───────────────────────────── */}
        {activeTab === 1 && collection && (
          <div className="space-y-4">
            {collection.error ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                No billing period found for {MONTHS.find((m) => m.value === month)?.label} {year}.
                Create a billing period first in the Billing section.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: 'Total Billed', value: formatCurrency(collection.totalBilled ?? 0), color: '' },
                  { label: 'Total Collected', value: formatCurrency(collection.totalCollected ?? 0), color: 'text-green-700' },
                  { label: 'Outstanding', value: formatCurrency(collection.totalPending ?? 0), color: 'text-red-600' },
                  {
                    label: 'Collection Rate',
                    value:
                      typeof collection.collectionRate === 'string'
                        ? collection.collectionRate
                        : '—',
                    color: 'text-primary-700',
                  },
                ].map(({ label, value, color }) => (
                  <Card key={label} padding="lg">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                    <p className={`mt-1 text-2xl font-bold ${color || 'text-slate-900'}`}>{value}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Expense summary ──────────────────────────────── */}
        {activeTab === 2 && expenseSummary && (
          <div className="space-y-4">
            <Card padding="lg">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Expenses</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {formatCurrency(expenseSummary.total ?? 0)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {expenseSummary.count ?? 0} expense records
              </p>
            </Card>
            {(expenseSummary.byCategory ?? []).length > 0 && (
              <Card padding="none">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Category</Th>
                      <Th>Amount</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {(expenseSummary.byCategory ?? []).map((c: any) => (
                      <Tr key={c.category}>
                        <Td>{String(c.category).replace(/_/g, ' ')}</Td>
                        <Td className="font-semibold tabular-nums">{formatCurrency(c.total)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Card>
            )}
            {(expenseSummary.byCategory ?? []).length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-400">
                No approved or paid expenses found for the selected period.
              </div>
            )}
          </div>
        )}

        {/* ── Account balances ─────────────────────────────── */}
        {activeTab === 3 && balances && (
          <div className="grid gap-4 sm:grid-cols-2">
            {(Array.isArray(balances) ? balances : []).length === 0 ? (
              <div className="col-span-2 rounded-xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-400">
                No active accounts found.
              </div>
            ) : (
              (Array.isArray(balances) ? balances : []).map((a: any) => (
                <Card key={a.id} padding="lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{a.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {String(a.accountType).replace(/_/g, ' ')}
                        {a.bankName ? ` · ${a.bankName}` : ''}
                      </p>
                    </div>
                    <Badge variant="muted">{String(a.accountType).replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="mt-3 text-2xl font-bold text-primary-700 tabular-nums">
                    {formatCurrency(a.currentBalance)}
                  </p>
                </Card>
              ))
            )}
          </div>
        )}
      </PageContainer>
    </>
  );
}
