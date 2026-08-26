'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { expensesApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge, expenseStatusBadge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate, EXPENSE_CATEGORIES } from '@/lib/utils';

const expenseSchema = z.object({
  description: z.string().min(1, 'Description required'),
  amount: z.string().min(1, 'Amount required').regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount'),
  category: z.string().min(1, 'Category required'),
  expenseDate: z.string().min(1, 'Date required'),
  vendorPayee: z.string().optional(),
  notes: z.string().optional(),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') })),
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'PAID', label: 'Paid' },
];

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', { category, status, page }],
    queryFn: () =>
      expensesApi
        .list({ category: category || undefined, status: status || undefined, page, limit: 20 })
        .then((r) => r.data),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
  });

  const createMutation = useMutation({
    mutationFn: (d: ExpenseFormData) => expensesApi.create(d),
    onSuccess: () => {
      toast.success('Expense logged');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setShowModal(false);
      reset();
    },
    onError: () => toast.error('Failed to log expense'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => expensesApi.approve(id),
    onSuccess: () => {
      toast.success('Expense approved');
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => toast.error('Failed to approve'),
  });

  return (
    <>
      <Header
        title="Expenses"
        subtitle="Society expenditure"
        actions={
          <Button onClick={() => setShowModal(true)} size="sm">
            <Plus size={14} /> Log Expense
          </Button>
        }
      />
      <PageContainer className="space-y-4">
        <div className="flex gap-3">
          <Select
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="w-48"
          />
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="w-40"
          />
        </div>

        <Card padding="none">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : !data?.data.length ? (
            <EmptyState icon={Wallet} title="No expenses yet" description="Log your first expense to track society spending" />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Ref #</Th>
                  <Th>Description</Th>
                  <Th>Category</Th>
                  <Th>Vendor / Payee</Th>
                  <Th>Amount</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {data.data.map((e) => (
                  <Tr key={e.id}>
                    <Td className="font-mono text-xs text-slate-700">
                      {e.invoiceNumber ?? e.referenceNumber ?? e.id.slice(0, 8)}
                    </Td>
                    <Td className="max-w-xs truncate">{e.description}</Td>
                    <Td className="text-xs">{e.category?.name ?? '—'}</Td>
                    <Td className="text-slate-500">{e.vendorPayee ?? '—'}</Td>
                    <Td className="font-semibold">{formatCurrency(e.amount)}</Td>
                    <Td>{formatDate(e.expenseDate)}</Td>
                    <Td>
                      <Badge variant={expenseStatusBadge(e.status)}>
                        {e.status}
                      </Badge>
                    </Td>
                    <Td>
                      {e.status === 'PENDING' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(e.id)}
                        >
                          Approve
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Card>

        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{data.meta.total} total expenses</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </PageContainer>

      <Modal open={showModal} onClose={() => { setShowModal(false); reset(); }} title="Log Expense">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
          <Input label="Description" placeholder="e.g. Generator maintenance" error={errors.description?.message} {...register('description')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Amount (₹)" type="number" step="0.01" placeholder="0.00" error={errors.amount?.message} {...register('amount')} />
            <Input label="Date" type="date" error={errors.expenseDate?.message} {...register('expenseDate')} />
          </div>
          <Select
            label="Category"
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
            placeholder="Select category"
            error={errors.category?.message}
            {...register('category')}
          />
          <Input label="Vendor / Payee (optional)" placeholder="Vendor name" {...register('vendorPayee')} />
          <Textarea label="Notes (optional)" placeholder="Additional details…" {...register('notes')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowModal(false); reset(); }}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Log Expense</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
