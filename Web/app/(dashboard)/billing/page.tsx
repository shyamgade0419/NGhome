'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { billingApi } from '@/lib/api/endpoints';
import { billingPeriodLabel } from '@/lib/types';
import type { BillingPeriod } from '@/lib/types';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Badge, billStatusBadge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { PageSpinner, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate } from '@/lib/utils';

const createPeriodSchema = z.object({
  periodYear: z.coerce.number().min(2020).max(2099),
  periodMonth: z.coerce.number().min(1).max(12),
  startDate: z.string().min(1, 'Required'),
  endDate: z.string().min(1, 'Required'),
  dueDate: z.string().min(1, 'Required'),
});
type CreatePeriodForm = z.infer<typeof createPeriodSchema>;

export default function BillingPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['billing-periods', page],
    queryFn: () =>
      billingApi.listPeriods({ page, limit: 20 }).then((r) => r.data),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreatePeriodForm>({
    resolver: zodResolver(createPeriodSchema),
  });

  const createMutation = useMutation({
    mutationFn: (d: CreatePeriodForm) => billingApi.createPeriod(d),
    onSuccess: () => {
      toast.success('Billing period created');
      qc.invalidateQueries({ queryKey: ['billing-periods'] });
      setShowModal(false);
      reset();
    },
    onError: () => toast.error('Failed to create billing period'),
  });

  const generateMutation = useMutation({
    mutationFn: (periodId: string) => billingApi.generateBills(periodId),
    onSuccess: (res: any) => {
      toast.success(`Generated ${res.data?.generated ?? '?'} bills`);
      qc.invalidateQueries({ queryKey: ['billing-periods'] });
    },
    onError: () => toast.error('Failed to generate bills'),
  });

  const publishMutation = useMutation({
    mutationFn: (periodId: string) => billingApi.publishPeriod(periodId),
    onSuccess: () => {
      toast.success('Period published to residents');
      qc.invalidateQueries({ queryKey: ['billing-periods'] });
    },
    onError: () => toast.error('Failed to publish period'),
  });

  return (
    <>
      <Header
        title="Billing Periods"
        subtitle="Manage monthly maintenance billing cycles"
        actions={
          <Button onClick={() => setShowModal(true)} size="sm">
            <Plus size={14} /> New Period
          </Button>
        }
      />
      <PageContainer className="space-y-4">
        <Card padding="none">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : !data?.data?.length ? (
            <EmptyState icon={Plus} title="No billing periods" description="Create your first billing period to start generating maintenance bills" />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Period</Th>
                  <Th>Status</Th>
                  <Th>Total Billed</Th>
                  <Th>Collected</Th>
                  <Th>Pending</Th>
                  <Th>Due Date</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {data.data.map((period: BillingPeriod) => (
                  <Tr key={period.id}>
                    <Td>
                      <Link href={`/billing/${period.id}`} className="font-medium text-primary-600 hover:underline">
                        {billingPeriodLabel(period)}
                      </Link>
                    </Td>
                    <Td>
                      <Badge variant={billStatusBadge(period.status)}>
                        {period.status.replace(/_/g, ' ')}
                      </Badge>
                    </Td>
                    <Td className="font-medium">{formatCurrency(period.totalBilled)}</Td>
                    <Td className="text-green-600">{formatCurrency(period.totalCollected)}</Td>
                    <Td className={parseFloat(period.totalPending) > 0 ? 'text-red-600 font-medium' : ''}>
                      {formatCurrency(period.totalPending)}
                    </Td>
                    <Td>{formatDate(period.dueDate)}</Td>
                    <Td>
                      <div className="flex gap-2">
                        {period.status === 'DRAFT' && (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={generateMutation.isPending}
                            onClick={() => generateMutation.mutate(period.id)}
                          >
                            Generate Bills
                          </Button>
                        )}
                        {(period.status === 'CALCULATED' || period.status === 'REVIEW') && (
                          <Button
                            size="sm"
                            loading={publishMutation.isPending}
                            onClick={() => publishMutation.mutate(period.id)}
                          >
                            Publish
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Card>

        {/* Pagination */}
        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Page {page} of {data.meta.totalPages} ({data.meta.total} periods)</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </PageContainer>

      {/* Create Period Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); reset(); }} title="Create Billing Period">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Year" type="number" placeholder="2025" error={errors.periodYear?.message} {...register('periodYear')} />
            <Input label="Month (1–12)" type="number" placeholder="8" error={errors.periodMonth?.message} {...register('periodMonth')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Start Date" type="date" error={errors.startDate?.message} {...register('startDate')} />
            <Input label="End Date" type="date" error={errors.endDate?.message} {...register('endDate')} />
          </div>
          <Input label="Due Date" type="date" error={errors.dueDate?.message} {...register('dueDate')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowModal(false); reset(); }}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create Period</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
