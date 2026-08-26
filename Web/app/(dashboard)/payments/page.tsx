'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { paymentsApi } from '@/lib/api/endpoints';
import type { Payment } from '@/lib/types';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge, paymentStatusBadge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDateTime } from '@/lib/utils';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

function PaymentsContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['payments', { status, page }],
    queryFn: () =>
      paymentsApi
        .list({ status: status || undefined, page, limit: 20 })
        .then((r) => r.data),
  });

  return (
    <>
      <Header
        title="Payments"
        subtitle="Payment verification & history"
      />
      <PageContainer className="space-y-4">
        <div className="flex gap-3">
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="w-52"
          />
        </div>

        <Card padding="none">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : !data?.data?.length ? (
            <EmptyState
              icon={Clock}
              title="No payments found"
              description="Payments submitted by residents will appear here"
            />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Reference</Th>
                  <Th>Resident</Th>
                  <Th>Flat</Th>
                  <Th>Amount</Th>
                  <Th>Method</Th>
                  <Th>Submitted</Th>
                  <Th>Status</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {data.data.map((p: Payment) => (
                  <Tr key={p.id}>
                    <Td className="font-mono text-xs text-slate-700">
                      {p.referenceNumber ?? p.utrNumber ?? p.id.slice(0, 8)}
                    </Td>
                    <Td>{p.user ? `${p.user.firstName} ${p.user.lastName}` : '—'}</Td>
                    <Td>{p.flat?.flatCode ?? p.flatId}</Td>
                    <Td className="font-semibold">{formatCurrency(p.amount)}</Td>
                    <Td>{p.paymentMethod.replace(/_/g, ' ')}</Td>
                    <Td className="text-xs text-slate-500">{formatDateTime(p.createdAt)}</Td>
                    <Td>
                      <Badge variant={paymentStatusBadge(p.status)}>
                        {p.status.replace(/_/g, ' ')}
                      </Badge>
                    </Td>
                    <Td>
                      <Link href={`/payments/${p.id}`}>
                        <Button variant="ghost" size="sm">Review</Button>
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Card>

        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{data.meta.total} total payments</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </PageContainer>
    </>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}>
      <PaymentsContent />
    </Suspense>
  );
}
