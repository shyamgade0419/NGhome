'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { History, Pencil, Plus, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { expensesApi, accountsApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
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
import { formatCurrency, formatDate, formatDateTime, EXPENSE_CATEGORIES } from '@/lib/utils';
import {
  changedFields, describeChanges, editValuesOf, paidAmountEffect, validateEdit,
  type ExpenseEditValues, type HistoryEntry,
} from '@/lib/expenseCorrections';
import type { Expense } from '@/lib/types';

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
  const { activeMembership } = useAuth();
  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN';
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

  // Approving an expense does not move any money — mark-paid is the only thing
  // that debits an account, and it had no UI on either client, so bank balances
  // only ever went up. Payments credited them and salaries debited them, but
  // every other expense left the balance untouched.
  const [payingExpense, setPayingExpense] = useState<Expense | null>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [payFundId, setPayFundId] = useState('');

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.listAccounts({ limit: 100 }).then((r: any) => r.data),
  });
  // The client hands back a plain array for a list with no paging (accounts, funds), and {data, meta} only
  // for a paged one. Reading `.data` off the array found nothing, so these pages always showed no accounts.
  const accounts: any[] = Array.isArray(accountsData) ? accountsData : (accountsData?.data ?? []);

  const { data: fundsData } = useQuery({
    queryKey: ['funds'],
    queryFn: () => accountsApi.listFunds({ limit: 100 }).then((r: any) => r.data),
  });
  const funds: any[] = Array.isArray(fundsData) ? fundsData : (fundsData?.data ?? []);

  const markPaidMutation = useMutation({
    mutationFn: () => expensesApi.markPaid(payingExpense!.id, payAccountId, payFundId || undefined),
    onSuccess: () => {
      toast.success('Expense marked paid — account balance updated');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      setPayingExpense(null);
      setPayAccountId('');
      setPayFundId('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to mark paid'),
  });

  /* ── Correcting an expense ──────────────────────────────────────────── */
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseEditValues | null>(null);
  const [comment, setComment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<Expense | null>(null);

  const posted = !!editing && editing.status !== 'PENDING';
  const eventLinked = editing?.linkedEntityType === 'EVENT';

  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm(editValuesOf(e));
    setComment('');
    setFormError(null);
  };
  const closeEdit = () => {
    setEditing(null);
    setForm(null);
  };

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => expensesApi.update(editing!.id, body),
    onSuccess: () => {
      toast.success(posted ? 'Correction saved' : 'Expense updated');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      closeEdit();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      setFormError(Array.isArray(m) ? m.join(', ') : (m ?? 'Could not save the change'));
    },
  });

  const submitEdit = () => {
    if (!editing || !form) return;
    const problem = validateEdit(form, posted, comment);
    if (problem) { setFormError(problem); return; }
    const body = changedFields(editing, form);
    if (Object.keys(body).length === 0) { setFormError('Nothing has changed yet.'); return; }
    setFormError(null);
    editMutation.mutate({ ...body, ...(comment.trim() ? { reason: comment.trim() } : {}) });
  };

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['expense-history', historyOf?.id],
    queryFn: () => expensesApi.history(historyOf!.id).then((r: any) => r.data as HistoryEntry[]),
    enabled: !!historyOf,
  });

  const effect = editing && form
    ? paidAmountEffect(editing.status, editing.amount, form.amount, editing.account?.name ?? null, editing.fund?.name ?? null)
    : null;
  const categoryChoices = [
    ...(form?.category && !EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === form.category.toLowerCase()) ? [form.category] : []),
    ...EXPENSE_CATEGORIES,
  ];

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
                {data.data.map((e) => {
                  const canEdit = e.status === 'PENDING' || ((e.status === 'APPROVED' || e.status === 'PAID') && isAdmin);
                  return (
                    <Tr key={e.id}>
                      <Td className="font-mono text-xs text-slate-700">
                        {e.invoiceNumber ?? e.referenceNumber ?? e.id.slice(0, 8)}
                      </Td>
                      <Td className="max-w-xs">
                        <p className="truncate">{e.description}</p>
                        {e.correctedAt && (
                          <button
                            type="button"
                            onClick={() => setHistoryOf(e)}
                            title={e.correctionNote ?? 'Corrected'}
                            className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-amber-700 hover:underline"
                          >
                            <History size={11} className="shrink-0" />
                            <span className="truncate">Corrected{e.correctionNote ? `: ${e.correctionNote}` : ''}</span>
                          </button>
                        )}
                        {e.fund && <p className="mt-0.5 text-xs text-slate-400">From {e.fund.name}</p>}
                      </Td>
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
                        <div className="flex items-center justify-end gap-1">
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
                          {e.status === 'APPROVED' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setPayingExpense(e); setPayAccountId(accounts[0]?.id ?? ''); setPayFundId(''); }}
                            >
                              Mark Paid
                            </Button>
                          )}
                          {canEdit && (
                            <Button size="sm" variant="ghost" onClick={() => openEdit(e)} aria-label={`Edit ${e.description}`}>
                              <Pencil size={13} /> Edit
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
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

      <Modal
        open={!!payingExpense}
        onClose={() => { setPayingExpense(null); setPayAccountId(''); setPayFundId(''); }}
        title="Mark Expense Paid"
      >
        {payingExpense && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{payingExpense.description}</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">
                {formatCurrency(payingExpense.amount)}
              </p>
            </div>
            <Select
              label="Pay from account"
              options={accounts.map((a: any) => ({
                value: a.id,
                label: `${a.name} — ${formatCurrency(a.currentBalance)}`,
              }))}
              value={payAccountId}
              onChange={(ev) => setPayAccountId(ev.target.value)}
            />
            <p className="-mt-2 text-xs text-slate-500">
              This deducts the amount from the selected account&rsquo;s balance and records it in
              that account&rsquo;s ledger. Approving an expense on its own doesn&rsquo;t move any
              money.
            </p>
            {payingExpense.linkedEntityType !== 'EVENT' && (
              <>
                <Select
                  label="Paid out of"
                  options={[
                    { value: '', label: 'Maintenance and general money (no fund)' },
                    ...funds.map((f: any) => ({ value: f.id, label: `${f.name} — ${formatCurrency(f.currentBalance)}` })),
                  ]}
                  value={payFundId}
                  onChange={(ev) => setPayFundId(ev.target.value)}
                />
                <p className="-mt-2 text-xs text-slate-500">
                  Choose a fund if this is spent from one (the corpus, a festival fund). The fund goes down by the
                  same amount, so the funds and the bank still add up.
                </p>
              </>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setPayingExpense(null); setPayAccountId(''); setPayFundId(''); }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => markPaidMutation.mutate()}
                loading={markPaidMutation.isPending}
                disabled={!payAccountId}
              >
                Mark Paid
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit / correct an expense */}
      <Modal open={!!editing} onClose={closeEdit} title={posted ? 'Correct Expense' : 'Edit Expense'}>
        {editing && form && (
          <div className="space-y-4">
            {posted && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                This expense is already <strong>{editing.status.toLowerCase()}</strong>. A correction is recorded with your
                name and your comment, and the old values are kept in the audit log.
              </div>
            )}
            <Input
              label="Description"
              value={form.description}
              onChange={(ev) => setForm({ ...form, description: ev.target.value })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Amount (₹)"
                type="number"
                step="0.01"
                value={form.amount}
                disabled={eventLinked}
                onChange={(ev) => setForm({ ...form, amount: ev.target.value })}
              />
              <Input
                label="Date"
                type="date"
                value={form.expenseDate}
                onChange={(ev) => setForm({ ...form, expenseDate: ev.target.value })}
              />
            </div>
            {eventLinked && (
              <p className="-mt-2 text-xs text-slate-500">
                This came from an event, so its amount is set there. To change it, undo the recording on the event and
                record it again.
              </p>
            )}
            {effect && (
              <p className="-mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{effect}</p>
            )}
            <Select
              label="Category"
              options={categoryChoices.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
              value={form.category}
              onChange={(ev) => setForm({ ...form, category: ev.target.value })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Vendor / Payee"
                value={form.vendorPayee}
                onChange={(ev) => setForm({ ...form, vendorPayee: ev.target.value })}
              />
              <Input
                label="Invoice number"
                value={form.invoiceNumber}
                onChange={(ev) => setForm({ ...form, invoiceNumber: ev.target.value })}
              />
            </div>
            <Textarea
              label={posted ? 'Comment: why is this being corrected? *' : 'Comment (optional)'}
              placeholder={posted ? 'e.g. The invoice was for ₹2,500, I typed ₹2,000' : 'Anything worth noting'}
              value={comment}
              maxLength={500}
              onChange={(ev) => setComment(ev.target.value)}
            />
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={closeEdit}>Cancel</Button>
              <Button onClick={submitEdit} loading={editMutation.isPending}>
                {posted ? 'Save correction' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* What was corrected, by whom, and why */}
      <Modal open={!!historyOf} onClose={() => setHistoryOf(null)} title="Corrections" size="md">
        {historyOf && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{historyOf.description}</p>
              <p className="mt-0.5 text-sm text-slate-600">
                {formatCurrency(historyOf.amount)} · {formatDate(historyOf.expenseDate)}
              </p>
            </div>
            {historyLoading ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : !history?.length ? (
              <p className="text-sm text-slate-500">No corrections recorded.</p>
            ) : (
              <ul className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="rounded-lg border border-slate-200 px-4 py-3">
                    <p className="text-xs text-slate-500">
                      {formatDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm text-slate-800">
                      {describeChanges(h.changes).map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    {h.reason && <p className="mt-1.5 text-sm italic text-slate-600">&ldquo;{h.reason}&rdquo;</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

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
