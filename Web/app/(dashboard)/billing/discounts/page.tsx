'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { billingApi, societyApi } from '@/lib/api/endpoints';
import { STATUS_LABEL, describeDiscount, monthEnd, monthStart, type DiscountType, type FlatDiscount } from '@/lib/flatDiscounts';
import { parseMoney } from '@/lib/openingBalances';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate } from '@/lib/utils';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function AddDiscountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: flats } = useQuery({
    queryKey: ['flats-for-discount'],
    queryFn: () => societyApi.flats({ limit: 500 }).then((r: any) => (r.data?.data ?? r.data ?? []) as { id: string; flatCode: string }[]),
    enabled: open,
  });
  const [flatId, setFlatId] = useState('');
  const [type, setType] = useState<DiscountType>('FIXED');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState(thisMonth());
  const [until, setUntil] = useState('');

  const amount = parseMoney(value);
  const problem =
    !flatId ? 'Choose a flat.'
    : amount === null || Number.isNaN(amount) || amount <= 0 ? 'Enter the discount.'
    : type === 'PERCENT' && amount > 100 ? 'A percentage cannot be more than 100.'
    : reason.trim().length < 3 ? 'Give a short reason.'
    : until && until < from ? 'It cannot end before it starts.'
    : null;

  const create = useMutation({
    mutationFn: () =>
      billingApi.createFlatDiscount({
        flatId, type, value: amount as number, reason: reason.trim(),
        effectiveFrom: monthStart(from), effectiveTo: until ? monthEnd(until) : null,
      }),
    onSuccess: () => {
      toast.success('Discount added');
      qc.invalidateQueries({ queryKey: ['flat-discounts'] });
      setFlatId(''); setValue(''); setReason(''); setUntil('');
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not add the discount'),
  });

  const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400';
  return (
    <Modal open={open} onClose={onClose} title="Add a flat discount">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-500">Flat</span>
          <select value={flatId} onChange={(e) => setFlatId(e.target.value)} className={field}>
            <option value="">Choose a flat…</option>
            {(flats ?? []).map((f) => <option key={f.id} value={f.id}>{f.flatCode}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as DiscountType)} className={field}>
              <option value="FIXED">A fixed amount (₹)</option>
              <option value="PERCENT">A percentage (%)</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">{type === 'PERCENT' ? 'Percentage off' : 'Amount off each bill (₹)'}</span>
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'PERCENT' ? '10' : '500'} className={field} />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-500">Reason (kept on the bill)</span>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Senior citizen concession" className={field} />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">From month</span>
            <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">Until month (optional)</span>
            <input type="month" value={until} onChange={(e) => setUntil(e.target.value)} className={field} />
          </label>
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          It is taken off every bill generated for these months, and kept if you regenerate. A percentage is of the flat&apos;s maintenance
          and charges, not water. A bill that is already generated changes when you generate it again.
        </p>
        {problem && <p className="text-xs text-red-600">{problem}</p>}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!!problem}>Add discount</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function FlatDiscountsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['flat-discounts'],
    queryFn: () => billingApi.listFlatDiscounts().then((r: any) => (r.data ?? r) as FlatDiscount[]),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['flat-discounts'] });
  const toggle = useMutation({
    mutationFn: (d: FlatDiscount) => billingApi.updateFlatDiscount(d.id, { isActive: !d.isActive }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not change the discount'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => billingApi.deleteFlatDiscount(id),
    onSuccess: () => { toast.success('Discount removed'); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not remove the discount'),
  });

  return (
    <>
      <Header
        title="Flat Discounts"
        subtitle="A standing discount for a particular flat, taken off its bills automatically"
        actions={<Button size="sm" onClick={() => setAdding(true)}><Plus size={14} className="mr-1.5" /> Add discount</Button>}
      />
      <PageContainer className="space-y-4">
        <Card className="flex items-start gap-3 text-sm text-slate-600">
          <BadgePercent size={18} className="mt-0.5 shrink-0 text-primary-600" />
          <p>
            Use this for a concession that applies month after month, such as a senior citizen or a founder member. It is taken off every
            bill generated while it is in force, shows as a <strong>Discount</strong> line on the bill and in the Discount column of the
            Maintenance Sheet, and is kept when you regenerate. For a one-off adjustment on a single bill, use the Maintenance Sheet.
          </p>
        </Card>

        <Card padding="none">
          {isLoading ? (
            <PageSpinner />
          ) : !data?.length ? (
            <EmptyState icon={BadgePercent} title="No flat discounts" description="Add one to take a fixed amount or a percentage off a flat's bills." />
          ) : (
            <Table>
              <Thead>
                <Tr><Th>Flat</Th><Th>Discount</Th><Th>Reason</Th><Th>From</Th><Th>Until</Th><Th>Status</Th><Th>Actions</Th></Tr>
              </Thead>
              <Tbody>
                {data.map((d) => (
                  <Tr key={d.id}>
                    <Td className="font-medium">{d.flatCode}{d.residentName && <span className="block text-xs font-normal text-slate-500">{d.residentName}</span>}</Td>
                    <Td>{describeDiscount(d.type, d.value)}</Td>
                    <Td className="text-slate-600">{d.reason}</Td>
                    <Td>{formatDate(d.effectiveFrom)}</Td>
                    <Td>{d.effectiveTo ? formatDate(d.effectiveTo) : 'No end'}</Td>
                    <Td><Badge variant={STATUS_LABEL[d.status].variant}>{STATUS_LABEL[d.status].text}</Badge></Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => toggle.mutate(d)} loading={toggle.isPending && toggle.variables?.id === d.id}>
                          {d.isActive ? 'Switch off' : 'Switch on'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Remove the discount for ${d.flatCode}`}
                          onClick={() => { if (window.confirm(`Remove the ${describeDiscount(d.type, d.value)} discount for ${d.flatCode}?`)) remove.mutate(d.id); }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Card>
      </PageContainer>
      <AddDiscountModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
