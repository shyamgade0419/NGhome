'use client';

/**
 * Committee: vehicles and parking. The register lists every vehicle households have registered,
 * and lets the committee remove a record (typically a plate that moved to a new owner) with a
 * reason the household sees. Parking is the society's slots: add them one at a time or as a block,
 * give a free slot to a flat, take it back, or delete one nobody holds. Residents register their
 * own vehicles and guards look them up, both in the mobile app.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Search, Plus, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { vehiclesApi, societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { fmtDayOf } from '@/lib/amenities';
import {
  KIND_LABEL, SLOT_FOR_LABEL, SLOT_FOR_OPTIONS, SLOT_STATUS_OPTIONS, bulkPreview, formatPlate,
  type SlotFor, type SlotRow, type SlotStatus, type VehicleRow,
} from '@/lib/vehicles';

type Tab = 'register' | 'parking';

const errorMessage = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

function Pager({ meta, page, setPage, noun }: { meta?: { total: number; totalPages: number }; page: number; setPage: (f: (p: number) => number) => void; noun: string }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-slate-500">
      <span>{meta.total} {noun}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </div>
    </div>
  );
}

const searchBox = 'w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

function Register() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [removed, setRemoved] = useState(false);
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<VehicleRow | null>(null);
  const [reason, setReason] = useState('');

  const filters = { search: search.trim() || undefined, removed: removed || undefined };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['vehicle-register', filters, page],
    queryFn: () => vehiclesApi.register({ ...filters, page, limit: 25 }).then((r) => r.data),
  });

  const remove = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => vehiclesApi.deactivate(id, why),
    onSuccess: () => {
      toast.success('Removed. The household has been told.');
      qc.invalidateQueries({ queryKey: ['vehicle-register'] });
      qc.invalidateQueries({ queryKey: ['parking-slots'] });
      setRemoving(null);
      setReason('');
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['vehicle-register'] });
      toast.error(errorMessage(e, 'Could not remove'));
    },
  });

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Number plate, flat or make" aria-label="Search vehicles" className={searchBox} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={removed} onChange={(e) => reset(setRemoved)(e.target.checked)} /> Show removed vehicles
        </label>
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={Car} title="Could not load the register" description="Check your connection and refresh the page." />
        ) : !data?.data.length ? (
          <EmptyState icon={Car} title={search || removed ? 'No vehicles match' : 'No vehicles yet'} description={search || removed ? 'Try different filters.' : 'Residents register their vehicles in the mobile app, and they appear here.'} />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Number</Th>
                <Th>Vehicle</Th>
                <Th>Flat</Th>
                <Th>Parking</Th>
                <Th>{removed ? 'Removed' : 'Registered'}</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.data.map((v) => (
                <Tr key={v.id}>
                  <Td className="whitespace-nowrap font-mono font-medium text-slate-900">{formatPlate(v.plate)}</Td>
                  <Td>
                    <div className="text-sm text-slate-900">{KIND_LABEL[v.kind]}</div>
                    <div className="text-xs text-slate-500">{[v.make, v.colour].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td className="font-medium">{v.flatCode}</Td>
                  <Td className="text-sm">{v.slotCodes.length ? v.slotCodes.join(', ') : <span className="text-slate-400">None</span>}</Td>
                  <Td className="whitespace-nowrap text-xs text-slate-600">
                    {fmtDayOf(removed && v.removedAt ? v.removedAt : v.createdAt)}
                    {removed && v.removedReason && <div className="italic text-slate-500">“{v.removedReason}”</div>}
                  </Td>
                  <Td className="text-right">
                    {!removed && <Button size="sm" variant="ghost" onClick={() => { setRemoving(v); setReason(''); }}>Remove</Button>}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
      <Pager meta={data?.meta} page={page} setPage={setPage} noun="vehicles" />

      <Modal open={!!removing} onClose={() => !remove.isPending && setRemoving(null)} title="Remove vehicle record">
        {removing && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="font-mono text-sm font-medium text-slate-900">{formatPlate(removing.plate)}</p>
              <p className="text-xs text-slate-500">{KIND_LABEL[removing.kind]} · flat {removing.flatCode}</p>
            </div>
            <p className="text-xs text-slate-500">
              The number is freed so it can be registered again, and the vehicle leaves its parking slot. The household is told, with your reason, which is also kept in the audit trail.
            </p>
            <Textarea label="Reason (required)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vehicle was sold" />
            <div className="flex justify-end gap-3">
              <Button variant="outline" disabled={remove.isPending} onClick={() => setRemoving(null)}>Cancel</Button>
              <Button variant="danger" disabled={reason.trim().length < 3} loading={remove.isPending} onClick={() => remove.mutate({ id: removing.id, why: reason.trim() })}>Remove</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function AddSlotsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [block, setBlock] = useState(false);
  const [code, setCode] = useState('');
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [pad, setPad] = useState('0');
  const [area, setArea] = useState('');
  const [slotFor, setSlotFor] = useState<SlotFor>('ANY');
  const [visitor, setVisitor] = useState(false);

  const preview = bulkPreview(prefix.trim(), Number(from), Number(to), Number(pad) || 0);

  const save = useMutation({
    mutationFn: () =>
      block
        ? vehiclesApi.bulkSlots({ prefix: prefix.trim() || undefined, from: Number(from), to: Number(to), pad: Number(pad) || 0, area: area.trim() || undefined, slotFor, visitor })
        : vehiclesApi.createSlot({ code: code.trim(), area: area.trim() || undefined, slotFor, visitor }),
    onSuccess: (res: any) => {
      toast.success(block ? `Added ${res.data?.created ?? preview?.count} slots` : 'Slot added');
      qc.invalidateQueries({ queryKey: ['parking-slots'] });
      setCode('');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not add')),
  });

  const valid = block ? !!preview : code.trim().length > 0;

  return (
    <Modal open={open} onClose={() => !save.isPending && onClose()} title={block ? 'Add a block of slots' : 'Add a parking slot'}>
      <div className="space-y-4">
        {block ? (
          <>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2"><Input label="Prefix" placeholder="B1-" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></div>
              <Input label="From" type="number" min={0} max={9999} value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input label="To" type="number" min={0} max={9999} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Input label="Pad numbers to (digits)" type="number" min={0} max={4} value={pad} onChange={(e) => setPad(e.target.value)} hint="2 gives 01, 02, 03…" />
            <p className={`rounded-lg px-3 py-2 text-xs ${preview ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
              {preview ? `Will add ${preview.count} slots: ${preview.first} to ${preview.last}. If any already exists, none are added.` : 'Choose a range of at most 200 slots, with From not after To.'}
            </p>
          </>
        ) : (
          <Input label="Slot code *" placeholder="B1-12" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
        )}
        <Input label="Area" placeholder="Basement 1 (optional)" value={area} onChange={(e) => setArea(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="For" options={SLOT_FOR_OPTIONS} value={slotFor} onChange={(e) => setSlotFor(e.target.value as SlotFor)} />
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={visitor} onChange={(e) => setVisitor(e.target.checked)} /> Visitor parking
          </label>
        </div>
        {visitor && <p className="text-xs text-slate-500">A visitor slot is never given to a flat.</p>}
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={() => setBlock((b) => !b)}>{block ? 'Add just one' : 'Add a block instead'}</Button>
          <div className="flex gap-3">
            <Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
            <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{block ? 'Add slots' : 'Add slot'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AllocateModal({ slot, onClose }: { slot: SlotRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [flatId, setFlatId] = useState('');
  const { data: flatsData } = useQuery({
    queryKey: ['parking-flats'],
    queryFn: () => societyApi.flats({ limit: 500 }).then((r: any) => r.data ?? r),
    enabled: !!slot,
    staleTime: 60_000,
  });
  const flats: any[] = Array.isArray(flatsData) ? flatsData : (flatsData?.data ?? []);

  const save = useMutation({
    mutationFn: () => vehiclesApi.allocate(slot!.id, flatId),
    onSuccess: () => {
      toast.success('Allocated. The flat has been told.');
      qc.invalidateQueries({ queryKey: ['parking-slots'] });
      setFlatId('');
      onClose();
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['parking-slots'] });
      toast.error(errorMessage(e, 'Could not allocate'));
    },
  });

  return (
    <Modal open={!!slot} onClose={() => !save.isPending && onClose()} title={slot ? `Allocate slot ${slot.code}` : 'Allocate'}>
      <div className="space-y-4">
        <Select label="Flat *" placeholder="Select a flat" value={flatId} onChange={(e) => setFlatId(e.target.value)} options={flats.map((f: any) => ({ value: f.id, label: f.flatCode }))} />
        <div className="flex justify-end gap-3">
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!flatId} onClick={() => save.mutate()}>Allocate</Button>
        </div>
      </div>
    </Modal>
  );
}

function Parking() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | SlotStatus>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [allocating, setAllocating] = useState<SlotRow | null>(null);

  const filters = { status: status || undefined, search: search.trim() || undefined };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['parking-slots', filters, page],
    queryFn: () => vehiclesApi.slots({ ...filters, page, limit: 50 }).then((r) => r.data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['parking-slots'] });
  const fail = (what: string) => (e: unknown) => { refresh(); toast.error(errorMessage(e, what)); };

  const release = useMutation({
    mutationFn: (id: string) => vehiclesApi.release(id),
    onSuccess: () => { toast.success('Slot taken back. The flat has been told.'); refresh(); },
    onError: fail('Could not release'),
  });
  const del = useMutation({
    mutationFn: (id: string) => vehiclesApi.deleteSlot(id),
    onSuccess: () => { toast.success('Slot deleted'); refresh(); },
    onError: fail('Could not delete'),
  });

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const anyFilter = !!(status || search);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {data ? <><strong className="text-slate-900">{data.meta.allocated}</strong> allocated · <strong className="text-slate-900">{data.meta.free}</strong> free</> : ' '}
        </p>
        <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" /> Add slots</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_auto]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Slot code or flat" aria-label="Search slots" className={searchBox} />
        </div>
        <Select aria-label="Status" options={SLOT_STATUS_OPTIONS} value={status} onChange={(e) => reset(setStatus)(e.target.value as '' | SlotStatus)} />
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => { setStatus(''); setSearch(''); setPage(1); }}>Clear</Button>}
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={Layers} title="Could not load parking" description="Check your connection and refresh the page." />
        ) : !data?.data.length ? (
          <EmptyState
            icon={Layers}
            title={anyFilter ? 'No slots match' : 'No parking slots yet'}
            description={anyFilter ? 'Try different filters.' : 'Add the society’s slots one at a time or as a block, then allocate them to flats.'}
            action={anyFilter ? undefined : <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" /> Add slots</Button>}
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Slot</Th>
                <Th>For</Th>
                <Th>Held by</Th>
                <Th>Vehicle</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.data.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <div className="font-mono font-medium text-slate-900">{s.code}</div>
                    {s.area && <div className="text-xs text-slate-500">{s.area}</div>}
                  </Td>
                  <Td className="text-sm">{SLOT_FOR_LABEL[s.slotFor]}</Td>
                  <Td>
                    {s.visitor ? <Badge variant="info">Visitor</Badge> : s.flatCode ? <span className="font-medium">{s.flatCode}</span> : <Badge variant="success">Free</Badge>}
                  </Td>
                  <Td className="font-mono text-sm">{s.vehiclePlate ? formatPlate(s.vehiclePlate) : <span className="text-slate-400">—</span>}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {s.flatId ? (
                      <Button size="sm" variant="ghost" loading={release.isPending && release.variables === s.id} onClick={() => release.mutate(s.id)}>Release</Button>
                    ) : (
                      <>
                        {!s.visitor && <Button size="sm" variant="ghost" onClick={() => setAllocating(s)}>Allocate</Button>}
                        <Button size="sm" variant="ghost" loading={del.isPending && del.variables === s.id} onClick={() => del.mutate(s.id)}>Delete</Button>
                      </>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
      <Pager meta={data?.meta} page={page} setPage={setPage} noun="slots" />

      <AddSlotsModal open={adding} onClose={() => setAdding(false)} />
      <AllocateModal slot={allocating} onClose={() => setAllocating(null)} />
    </>
  );
}

export default function VehiclesPage() {
  const [tab, setTab] = useState<Tab>('register');
  return (
    <>
      <Header title="Vehicles & parking" subtitle="Registered vehicles and the society's parking slots" />
      <PageContainer className="space-y-4">
        <div role="tablist" className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {(['register', 'parking'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {t === 'register' ? 'Vehicles' : 'Parking'}
            </button>
          ))}
        </div>
        {tab === 'register' ? <Register /> : <Parking />}
      </PageContainer>
    </>
  );
}
