'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { accountsApi, billingApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import type { AdvanceCredits } from '@/lib/flatDiscounts';
import { parseMoney } from '@/lib/openingBalances';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency } from '@/lib/utils';

type Row = AdvanceCredits['flats'][number];

function RefundModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accounts } = useQuery({
    queryKey: ['accounts-for-refund'],
    queryFn: () => accountsApi.listAccounts().then((r: any) => (Array.isArray(r.data) ? r.data : r.data?.data ?? []) as any[]),
    enabled: !!row,
  });
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  const balance = row ? parseFloat(row.balance) : 0;
  const parsed = parseMoney(amount);
  const account = (accounts ?? []).find((a) => a.id === accountId);
  const problem =
    parsed === null || Number.isNaN(parsed) || parsed <= 0 ? 'Enter how much to refund.'
    : parsed > balance ? `The flat holds only ${formatCurrency(balance)}.`
    : !accountId ? 'Choose the account it is paid from.'
    : account && parseFloat(account.currentBalance) < parsed ? `${account.name} holds only ${formatCurrency(account.currentBalance)}.`
    : reason.trim().length < 3 ? 'Give a short reason.'
    : null;

  const refund = useMutation({
    mutationFn: () =>
      billingApi.refundAdvance({ flatId: row!.flatId, amount: parsed as number, accountId, reason: reason.trim(), ...(reference.trim() ? { referenceNumber: reference.trim() } : {}) }),
    onSuccess: () => {
      toast.success('Refund recorded');
      qc.invalidateQueries({ queryKey: ['advance-credits'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setAmount(''); setReason(''); setReference('');
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not refund'),
  });

  const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400';
  return (
    <Modal open={!!row} onClose={onClose} title={row ? `Refund advance — ${row.flatCode}` : 'Refund advance'}>
      {row && (
        <div className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {row.flatCode} holds <strong>{formatCurrency(balance)}</strong> paid ahead. A refund takes the money out of the account you choose and
            out of the flat&apos;s advance, and cannot be undone.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-500">Refund (₹)</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(balance)} className={field} />
              <button type="button" onClick={() => setAmount(String(balance))} className="mt-1 text-xs font-medium text-primary-600 hover:underline">Refund all of it</button>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-500">Paid out of</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
                <option value="">Choose an account…</option>
                {(accounts ?? []).filter((a) => a.isActive !== false).map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">Reason</span>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Flat sold, advance returned" className={field} />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">UTR or cheque number (optional)</span>
            <input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} className={field} />
          </label>
          {problem && <p className="text-xs text-red-600">{problem}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="danger" onClick={() => refund.mutate()} loading={refund.isPending} disabled={!!problem}>Refund {parsed && !Number.isNaN(parsed) ? formatCurrency(parsed) : ''}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function AdvanceCreditPage() {
  const { activeMembership } = useAuth();
  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN';
  const [refunding, setRefunding] = useState<Row | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['advance-credits'],
    queryFn: () => billingApi.listAdvanceCredits().then((r: any) => (r.data ?? r) as AdvanceCredits),
  });

  return (
    <>
      <Header title="Advance Credit" subtitle="Money flats have paid ahead of what they owed" />
      <PageContainer className="space-y-4">
        <Card className="flex items-start gap-3 text-sm text-slate-600">
          <Wallet size={18} className="mt-0.5 shrink-0 text-primary-600" />
          <p>
            When a flat pays more than it owes, the extra is kept as an advance and applied to its next bill when that is published.
            {isAdmin ? ' If a flat wants it back instead, refund it here.' : ' Only the admin can refund an advance.'}
          </p>
        </Card>

        {isLoading || !data ? (
          <PageSpinner />
        ) : (
          <>
            <Card padding="sm" className="max-w-xs">
              <p className="text-xs text-slate-500">Held in advance</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">{formatCurrency(data.total)}</p>
              <p className="text-xs text-slate-500">{data.flats.length} flat{data.flats.length === 1 ? '' : 's'}</p>
            </Card>
            <Card padding="none">
              {data.flats.length === 0 ? (
                <EmptyState icon={Wallet} title="No advance held" description="No flat has paid ahead of what it owes." />
              ) : (
                <Table>
                  <Thead><Tr><Th>Flat</Th><Th>Resident</Th><Th>Advance held</Th>{isAdmin && <Th>Actions</Th>}</Tr></Thead>
                  <Tbody>
                    {data.flats.map((f) => (
                      <Tr key={f.flatId}>
                        <Td className="font-medium">{f.flatCode}</Td>
                        <Td className="text-slate-600">{f.residentName ?? '—'}</Td>
                        <Td className="font-medium text-green-700">{formatCurrency(f.balance)}</Td>
                        {isAdmin && <Td><Button size="sm" variant="outline" onClick={() => setRefunding(f)}>Refund</Button></Td>}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Card>
          </>
        )}
      </PageContainer>
      <RefundModal row={refunding} onClose={() => setRefunding(null)} />
    </>
  );
}
