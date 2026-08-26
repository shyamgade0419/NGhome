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
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate } from '@/lib/utils';

const tabs = ['Outstanding Dues', 'Collection Summary', 'Expense Summary', 'Account Balances'];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const params = { from: fromDate || undefined, to: toDate || undefined };

  const { data: outstanding, isLoading: l1 } = useQuery({
    queryKey: ['report-outstanding', params],
    queryFn: () => reportsApi.outstandingDues(params).then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: collection, isLoading: l2 } = useQuery({
    queryKey: ['report-collection', params],
    queryFn: () => reportsApi.collectionSummary(params).then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: expenseSummary, isLoading: l3 } = useQuery({
    queryKey: ['report-expenses', params],
    queryFn: () => reportsApi.expenseSummary(params).then((r) => r.data),
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
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {tabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === i
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Date range filter (where applicable) */}
        {activeTab < 3 && (
          <div className="flex gap-3">
            <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-44" />
            <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-44" />
          </div>
        )}

        {isLoading && <PageSpinner />}

        {/* Outstanding dues */}
        {activeTab === 0 && outstanding && (
          <Card padding="none">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900">
                Total Outstanding: <span className="text-red-600">{formatCurrency(outstanding.totalPending ?? outstanding.totalOutstanding ?? '0')}</span>
              </p>
            </div>
            <Table>
              <Thead>
                <Tr>
                  <Th>Bill #</Th>
                  <Th>Resident</Th>
                  <Th>Flat</Th>
                  <Th>Due Date</Th>
                  <Th>Outstanding</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {(outstanding.bills ?? []).map((b: any) => (
                  <Tr key={b.id}>
                    <Td className="font-medium">{b.invoiceNumber ?? b.id?.slice(0, 8)}</Td>
                    <Td>{b.user ? `${b.user.firstName} ${b.user.lastName}` : (b.resident?.displayName ?? 'â€”')}</Td>
                    <Td>{b.flat?.flatCode ?? b.flat?.unitNumber ?? b.flat?.number ?? 'â€”'}</Td>
                    <Td>{formatDate(b.dueDate)}</Td>
                    <Td className="font-semibold text-red-600">{formatCurrency(b.pendingAmount)}</Td>
                    <Td>
                      <Badge variant={b.isPaid ? 'success' : b.isPublished ? 'warning' : 'muted'}>
                        {b.isPaid ? 'Paid' : b.isPublished ? 'Unpaid' : 'Draft'}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        )}

        {/* Collection summary */}
        {activeTab === 1 && collection && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: 'Total Billed', value: collection.totalBilled },
              { label: 'Total Collected', value: collection.totalCollected },
              { label: 'Outstanding', value: collection.totalPending ?? collection.totalOutstanding },
              { label: 'Collection Rate', value: collection.collectionRate ? `${collection.collectionRate}%` : 'â€”' },
            ].map(({ label, value }) => (
              <Card key={label} padding="lg">
                <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {typeof value === 'string' && value.includes('%') ? value : formatCurrency(value ?? '0')}
                </p>
              </Card>
            ))}
          </div>
        )}

        {/* Expense summary */}
        {activeTab === 2 && expenseSummary && (
          <div className="space-y-4">
            <Card padding="lg">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Expenses</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{formatCurrency(expenseSummary.total ?? '0')}</p>
            </Card>
            <Card padding="none">
              <Table>
                <Thead>
                  <Tr><Th>Category</Th><Th>Amount</Th><Th>Count</Th></Tr>
                </Thead>
                <Tbody>
                  {(expenseSummary.byCategory ?? []).map((c: any) => (
                    <Tr key={c.category}>
                      <Td>{c.category.replace(/_/g, ' ')}</Td>
                      <Td className="font-semibold">{formatCurrency(c.total)}</Td>
                      <Td>{c.count}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          </div>
        )}

        {/* Account balances */}
        {activeTab === 3 && balances && (
          <div className="grid gap-4 sm:grid-cols-2">
            {(Array.isArray(balances) ? balances : balances?.accounts ?? []).map((a: any) => (
              <Card key={a.id} padding="lg">
                <p className="font-semibold text-slate-900">{a.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{a.accountType?.replace(/_/g, ' ')}</p>
                <p className="mt-3 text-2xl font-bold text-primary-700">{formatCurrency(a.currentBalance)}</p>
              </Card>
            ))}
          </div>
        )}
      </PageContainer>
    </>
  );
}
