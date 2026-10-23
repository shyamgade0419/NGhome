'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { amenitiesApi, amenityBookingsApi, accountsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatCurrency } from '@/lib/utils';
import {
  type Amenity,
  type AmenityBooking,
  type AmenityForm,
  type AmenityPayload,
  type BookingStatus,
  EMPTY_FORM,
  buildAmenityPayload,
  fmtMinutes,
  fmtRange,
  formFromAmenity,
} from '@/lib/amenities';

type Tab = 'bookings' | 'spaces';
type Filter = 'PENDING' | 'CONFIRMED' | '';

const STATUS_BADGE: Record<BookingStatus, { label: string; variant: 'warning' | 'success' | 'danger' | 'muted' }> = {
  PENDING: { label: 'Awaiting approval', variant: 'warning' },
  CONFIRMED: { label: 'Confirmed', variant: 'success' },
  REJECTED: { label: 'Declined', variant: 'danger' },
  CANCELLED: { label: 'Cancelled', variant: 'muted' },
};

const errorMessage = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

export default function AmenitiesPage() {
  const [tab, setTab] = useState<Tab>('bookings');
  return (
    <>
      <Header title="Amenities" subtitle="Shared spaces residents can book" />
      <PageContainer className="space-y-4">
        <div className="flex gap-1 border-b border-slate-200">
          {(['bookings', 'spaces'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t === 'bookings' ? 'Bookings' : 'Spaces'}
            </button>
          ))}
        </div>
        {tab === 'bookings' ? <BookingsTab /> : <SpacesTab />}
      </PageContainer>
    </>
  );
}

function BookingsTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [page, setPage] = useState(1);
  const [declining, setDeclining] = useState<AmenityBooking | null>(null);
  const [reason, setReason] = useState('');
  const [collecting, setCollecting] = useState<AmenityBooking | null>(null);
  const [accountId, setAccountId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['amenity-bookings', { filter, page }],
    queryFn: () => amenityBookingsApi.list({ status: filter || undefined, page, limit: 20 }).then((r) => r.data),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.listAccounts({ limit: 100 }).then((r: any) => r.data),
  });
  const accounts: any[] = accountsData?.data ?? [];

  const done = (message: string) => () => {
    toast.success(message);
    qc.invalidateQueries({ queryKey: ['amenity-bookings'] });
  };
  const failed = (fallback: string) => (e: any) => toast.error(errorMessage(e, fallback));

  const approve = useMutation({ mutationFn: (id: string) => amenityBookingsApi.approve(id), onSuccess: done('Booking approved'), onError: failed('Could not approve') });
  const cancel = useMutation({ mutationFn: (id: string) => amenityBookingsApi.cancel(id), onSuccess: done('Booking cancelled'), onError: failed('Could not cancel') });
  const waive = useMutation({ mutationFn: (id: string) => amenityBookingsApi.waiveFee(id), onSuccess: done('Fee waived'), onError: failed('Could not waive') });
  const decline = useMutation({
    mutationFn: () => amenityBookingsApi.reject(declining!.id, reason.trim() || undefined),
    onSuccess: () => {
      done('Request declined')();
      setDeclining(null);
      setReason('');
    },
    onError: failed('Could not decline'),
  });
  const collect = useMutation({
    mutationFn: () => amenityBookingsApi.collectFee(collecting!.id, accountId),
    onSuccess: () => {
      done('Fee recorded — account balance updated')();
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setCollecting(null);
      setAccountId('');
    },
    onError: failed('Could not record the fee'),
  });

  return (
    <>
      <div className="flex gap-3">
        <Select
          options={[
            { value: 'PENDING', label: 'Requests awaiting approval' },
            { value: 'CONFIRMED', label: 'Confirmed' },
            { value: '', label: 'All bookings' },
          ]}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setPage(1);
          }}
          className="w-64"
        />
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !data?.data.length ? (
          <EmptyState
            icon={CalendarCheck}
            title={filter === 'PENDING' ? 'No requests waiting' : 'No bookings'}
            description={filter === 'PENDING' ? 'Requests for spaces that need approval appear here.' : 'Nothing has been booked yet.'}
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Space</Th>
                <Th>When (IST)</Th>
                <Th>Booked by</Th>
                <Th>Fee</Th>
                <Th>Status</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.data.map((b) => {
                const s = STATUS_BADGE[b.status];
                const future = new Date(b.startAt).getTime() > Date.now();
                const live = b.status === 'PENDING' || b.status === 'CONFIRMED';
                const fee = Number(b.feeAmount);
                return (
                  <Tr key={b.id}>
                    <Td className="font-medium">{b.amenity?.name ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{fmtRange(b.startAt, b.endAt)}</Td>
                    <Td>
                      <div>{b.user ? `${b.user.firstName} ${b.user.lastName}` : '—'}</div>
                      <div className="text-xs text-slate-500">
                        {b.flat?.flatCode ?? ''}
                        {b.guestCount > 0 ? ` · ${b.guestCount} guest${b.guestCount === 1 ? '' : 's'}` : ''}
                      </div>
                      {b.note && <div className="text-xs italic text-slate-500">“{b.note}”</div>}
                    </Td>
                    <Td>
                      {fee > 0 && b.feeStatus !== 'NONE' ? (
                        <>
                          <div className="font-semibold">{formatCurrency(fee)}</div>
                          <div className="text-xs capitalize text-slate-500">{b.feeStatus.toLowerCase()}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge variant={s.variant}>{s.label}</Badge>
                      {b.status === 'REJECTED' && b.rejectionReason && (
                        <div className="mt-1 text-xs text-slate-500">{b.rejectionReason}</div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        {b.status === 'PENDING' && future && (
                          <>
                            <Button size="sm" variant="ghost" loading={approve.isPending && approve.variables === b.id} onClick={() => approve.mutate(b.id)}>
                              Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeclining(b)}>Decline</Button>
                          </>
                        )}
                        {b.status === 'CONFIRMED' && b.feeStatus === 'DUE' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCollecting(b);
                                setAccountId(accounts.length === 1 ? accounts[0].id : '');
                              }}
                            >
                              Fee collected
                            </Button>
                            <Button size="sm" variant="ghost" loading={waive.isPending && waive.variables === b.id} onClick={() => waive.mutate(b.id)}>
                              Waive
                            </Button>
                          </>
                        )}
                        {live && future && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm(`Cancel ${b.amenity?.name ?? 'this booking'} on ${fmtRange(b.startAt, b.endAt)}? The resident will be told.`)) {
                                cancel.mutate(b.id);
                              }
                            }}
                          >
                            Cancel
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
          <span>{data.meta.total} bookings</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Modal open={!!declining} onClose={() => { setDeclining(null); setReason(''); }} title="Decline request">
        {declining && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {declining.amenity?.name} · {fmtRange(declining.startAt, declining.endAt)}
            </p>
            <Textarea
              label="Reason (the resident will see this)"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional"
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setDeclining(null); setReason(''); }}>Cancel</Button>
              <Button variant="danger" loading={decline.isPending} onClick={() => decline.mutate()}>Decline request</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!collecting} onClose={() => { setCollecting(null); setAccountId(''); }} title="Fee collected">
        {collecting && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{collecting.amenity?.name}</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">{formatCurrency(collecting.feeAmount)}</p>
            </div>
            <Select
              label="Paid into account"
              placeholder="Select account"
              options={accounts.map((a: any) => ({ value: a.id, label: `${a.name} — ${formatCurrency(a.currentBalance)}` }))}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
            {accounts.length === 0 && (
              <p className="text-xs text-amber-700">No accounts yet. Add a bank account or cash box under Accounts first.</p>
            )}
            <p className="-mt-2 text-xs text-slate-500">
              Adds this amount to the account&rsquo;s balance and records it in that account&rsquo;s ledger.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setCollecting(null); setAccountId(''); }}>Cancel</Button>
              <Button loading={collect.isPending} disabled={!accountId} onClick={() => collect.mutate()}>Record fee</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function SpacesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Amenity | 'new' | null>(null);
  const [form, setForm] = useState<AmenityForm>(EMPTY_FORM);
  const set = <K extends keyof AmenityForm>(key: K, value: AmenityForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { data, isLoading } = useQuery({
    queryKey: ['amenities-admin'],
    queryFn: () => amenitiesApi.list(true).then((r) => r.data),
  });

  const open = (target: Amenity | 'new') => {
    setForm(target === 'new' ? EMPTY_FORM : formFromAmenity(target));
    setEditing(target);
  };

  const save = useMutation({
    mutationFn: (payload: AmenityPayload) =>
      editing && editing !== 'new' ? amenitiesApi.update(editing.id, payload) : amenitiesApi.create(payload),
    onSuccess: () => {
      toast.success(editing === 'new' ? 'Amenity added' : 'Changes saved');
      qc.invalidateQueries({ queryKey: ['amenities-admin'] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(errorMessage(e, 'Could not save')),
  });

  const submit = () => {
    const result = buildAmenityPayload(form);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    save.mutate(result.payload);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Rule changes apply to new bookings only; existing bookings are left as they were.</p>
        <Button size="sm" onClick={() => open('new')}><Plus size={14} /> Add Amenity</Button>
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !data?.length ? (
          <EmptyState icon={CalendarCheck} title="No amenities yet" description="Add your clubhouse, hall, court or gym. Residents can book it as soon as you save." />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Space</Th>
                <Th>Open (IST)</Th>
                <Th>Slots</Th>
                <Th>Booking</Th>
                <Th>Fee</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.map((a) => (
                <Tr key={a.id} className={a.isActive ? '' : 'opacity-60'}>
                  <Td className="font-medium">
                    {a.name} {!a.isActive && <Badge variant="muted" className="ml-1">Hidden</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap">{fmtMinutes(a.opensAtMin)} – {fmtMinutes(a.closesAtMin)}</Td>
                  <Td>{a.slotMinutes} min{a.capacity > 1 ? ` · ${a.capacity} at a time` : ''}</Td>
                  <Td>{a.bookingMode === 'INSTANT' ? 'Instant' : 'Needs approval'}</Td>
                  <Td>{a.fee && Number(a.fee) > 0 ? formatCurrency(a.fee) : 'Free'}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => open(a)}>Edit</Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => !save.isPending && setEditing(null)} title={editing === 'new' ? 'Add Amenity' : 'Edit Amenity'} size="lg">
        <div className="space-y-4">
          <Input label="Name" value={form.name} maxLength={80} placeholder="e.g. Clubhouse" onChange={(e) => set('name', e.target.value)} />
          <Textarea label="Description (optional)" value={form.description} maxLength={1000} onChange={(e) => set('description', e.target.value)} />
          <Textarea label="House rules (shown to residents before they book)" value={form.rules} maxLength={2000} onChange={(e) => set('rules', e.target.value)} />
          <Select
            label="Booking"
            options={[
              { value: 'INSTANT', label: 'Instant — confirmed straight away' },
              { value: 'NEEDS_APPROVAL', label: 'Needs approval from the committee' },
            ]}
            value={form.bookingMode}
            onChange={(e) => set('bookingMode', e.target.value as AmenityForm['bookingMode'])}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Opens" value={form.opens} placeholder="06:00" hint="24-hour India time" onChange={(e) => set('opens', e.target.value)} />
            <Input label="Closes" value={form.closes} placeholder="22:00" onChange={(e) => set('closes', e.target.value)} />
            <Input label="Slot length (minutes)" inputMode="numeric" value={form.slotMinutes} onChange={(e) => set('slotMinutes', e.target.value)} />
            <Input label="Slots per booking" inputMode="numeric" value={form.maxSlots} onChange={(e) => set('maxSlots', e.target.value)} />
            <Input label="Bookings per slot" inputMode="numeric" value={form.capacity} hint="1 = one flat at a time" onChange={(e) => set('capacity', e.target.value)} />
            <Input label="Days ahead" inputMode="numeric" value={form.advanceDays} onChange={(e) => set('advanceDays', e.target.value)} />
            <Input label="Monthly limit per flat" inputMode="numeric" value={form.monthlyCap} placeholder="None" onChange={(e) => set('monthlyCap', e.target.value)} />
            <Input label="Cancel notice (hours)" inputMode="numeric" value={form.cancelHours} onChange={(e) => set('cancelHours', e.target.value)} />
          </div>
          <Input
            label="Fee per booking (₹)"
            inputMode="decimal"
            value={form.fee}
            placeholder="Free"
            hint="You mark it collected into an account once you receive it."
            onChange={(e) => set('fee', e.target.value)}
          />
          {editing !== 'new' && (
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              <span>
                <span className="font-medium">Available to book</span>
                <span className="block text-xs text-slate-500">Untick to hide it from residents. Existing bookings are kept.</span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)} disabled={save.isPending}>Cancel</Button>
            <Button onClick={submit} loading={save.isPending}>{editing === 'new' ? 'Add Amenity' : 'Save changes'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
