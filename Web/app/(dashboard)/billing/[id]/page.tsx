'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { billingApi } from '@/lib/api/endpoints';
import { billingPeriodLabel } from '@/lib/types';
import type { MaintenanceBill } from '@/lib/types';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, billStatusBadge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function BillingPeriodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: period, isLoading: periodLoading } = useQuery({
    queryKey: ['billing-period', id],
    queryFn: () => billingApi.getPeriod(id).then((r) => r.data),
  });

  const { data: billsData, isLoading: billsLoading } = useQuery({
    queryKey: ['billing-period-bills', id],
    queryFn: () => billingApi.listBills(id, { limit: 100 }).then((r) => r.data),
    enabled: !!period,
  });

  if (periodLoading) return <PageSpinner />;
  if (!period) return <div className="p-8 text-slate-500">Billing period not found.</div>;

  const bills: MaintenanceBill[] = billsData?.data ?? [];

  return (
    <>
      <Header
        title={billingPeriodLabel(period)}
        subtitle="Billing period detail"
        actions={
          <Link href="/billing">
            <button className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              <ArrowLeft size={14} /> Back to Periods
            </button>
          </Link>
        }
      />
      <PageContainer className="space-y-6">
        {/* Period summary */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card padding="lg">
            <CardHeader>
              <CardTitle>Period Details</CardTitle>
              <Badge variant={billStatusBadge(period.status)}>{period.status.replace(/_/g, ' ')}</Badge>
            </CardHeader>
            <dl className="space-y-3 text-sm">
              {[
                { label: 'Period', value: billingPeriodLabel(period) },
                { label: 'Start Date', value: formatDate(period.startDate) },
                { label: 'End Date', value: formatDate(period.endDate) },
                { label: 'Due Date', value: formatDate(period.dueDate) },
                ...(period.publishedAt ? [{ label: 'Published', value: formatDate(period.publishedAt) }] : []),
                ...(period.closedAt ? [{ label: 'Closed', value: formatDate(period.closedAt) }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card padding="lg">
            <CardHeader><CardTitle>Financial Summary</CardTitle></CardHeader>
            <dl className="space-y-3 text-sm">
              {[
                { label: 'Total Billed', value: formatCurrency(period.totalBilled), highlight: false },
                { label: 'Collected', value: formatCurrency(period.totalCollected), highlight: false },
                { label: 'Pending', value: formatCurrency(period.totalPending), highlight: parseFloat(period.totalPending) > 0 },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className={`text-lg font-bold ${highlight ? 'text-red-600' : 'text-slate-900'}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        {/* Bills list */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Bills ({bills.length})
          </h2>
          <Card padding="none">
            {billsLoading ? (
              <div className="flex justify-center py-12 text-sm text-slate-400">Loading bills…</div>
            ) : !bills.length ? (
              <div className="py-12 text-center text-sm text-slate-400">
                No bills generated yet. Use &ldquo;Generate Bills&rdquo; from the periods list.
              </div>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Invoice #</Th>
                    <Th>Flat</Th>
                    <Th>Total</Th>
                    <Th>Paid</Th>
                    <Th>Pending</Th>
                    <Th>Due Date</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {bills.map((bill) => (
                    <Tr key={bill.id}>
                      <Td className="font-mono text-xs">{bill.invoiceNumber}</Td>
                      <Td>{bill.flatCode}</Td>
                      <Td className="font-medium">{formatCurrency(bill.totalAmount)}</Td>
                      <Td className="text-green-600">{formatCurrency(bill.paidAmount)}</Td>
                      <Td className={parseFloat(bill.pendingAmount) > 0 ? 'text-red-600 font-medium' : ''}>
                        {formatCurrency(bill.pendingAmount)}
                      </Td>
                      <Td>{formatDate(bill.dueDate)}</Td>
                      <Td>
                        <Badge variant={bill.isPaid ? 'success' : bill.isPublished ? 'warning' : 'muted'}>
                          {bill.isPaid ? 'Paid' : bill.isPublished ? 'Unpaid' : 'Draft'}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        </div>
      </PageContainer>
    </>
  );
}
