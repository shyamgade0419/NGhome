'use client';

/**
 * Committee: household help. The register lists everyone who works in the society's homes, which
 * flats they work for, and whether the committee has confirmed who they are. A person can be
 * suspended (the gate then refuses them, and the households that employ them are told why) and
 * reinstated. The attendance tab is the gate log: when each person came and left, and who let
 * them in. Residents add their own help and guards let them in, both in the mobile app.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserCheck, BadgeCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { helpersApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { fmtDayOf, fmtTime } from '@/lib/amenities';
import { ROLE_LABEL, STATUS_OPTIONS, duration, helperBadge, type HelperRow, type HelperStatus } from '@/lib/helpers';

type Tab = 'register' | 'attendance';

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

function Register() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | HelperStatus>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [suspending, setSuspending] = useState<HelperRow | null>(null);
  const [reason, setReason] = useState('');

  const filters = { status: status || undefined, search: search.trim() || undefined };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['helper-register', filters, page],
    queryFn: () => helpersApi.register({ ...filters, page, limit: 25 }).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['helper-register'] });
  const fail = (what: string) => (e: unknown) => {
    refresh();
    toast.error(errorMessage(e, what));
  };

  const verify = useMutation({
    mutationFn: (id: string) => helpersApi.verify(id),
    onSuccess: () => { toast.success('Marked as verified'); refresh(); },
    onError: fail('Could not verify'),
  });
  const reinstate = useMutation({
    mutationFn: (id: string) => helpersApi.reinstate(id),
    onSuccess: () => { toast.success('They can be let in again'); refresh(); },
    onError: fail('Could not reinstate'),
  });
  const suspend = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => helpersApi.suspend(id, why),
    onSuccess: () => {
      toast.success('Suspended. The households that employ them have been told.');
      refresh();
      setSuspending(null);
      setReason('');
    },
    onError: fail('Could not suspend'),
  });

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const anyFilter = !!(status || search);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_auto]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
            placeholder="Name, phone or flat"
            aria-label="Search household help"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <Select aria-label="Status" options={STATUS_OPTIONS} value={status} onChange={(e) => reset(setStatus)(e.target.value as '' | HelperStatus)} />
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => { setStatus(''); setSearch(''); setPage(1); }}>Clear</Button>}
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={UserCheck} title="Could not load the register" description="Check your connection and refresh the page." />
        ) : !data?.data.length ? (
          <EmptyState
            icon={UserCheck}
            title={anyFilter ? 'No one matches' : 'No household help yet'}
            description={anyFilter ? 'Try different filters.' : 'Residents add their maid, cook or driver in the mobile app, and they appear here.'}
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Person</Th>
                <Th>Works for</Th>
                <Th>Status</Th>
                <Th>Last here (IST)</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.data.map((h) => {
                const b = helperBadge(h);
                return (
                  <Tr key={h.id}>
                    <Td>
                      <div className="flex items-center gap-1 font-medium text-slate-900">
                        {h.name}
                        {h.verified && <BadgeCheck size={15} className="text-emerald-600" aria-label="Verified by the committee" />}
                      </div>
                      <div className="text-xs text-slate-500">{ROLE_LABEL[h.role]}{h.phone ? ` · ${h.phone}` : ''}</div>
                    </Td>
                    <Td className="text-sm">{h.flatCodes.length ? h.flatCodes.join(', ') : <span className="text-slate-400">No flat</span>}</Td>
                    <Td>
                      <Badge variant={b.variant}>{b.label}</Badge>
                      {h.status === 'SUSPENDED' && h.suspendedReason && <div className="mt-1 text-xs italic text-slate-500">“{h.suspendedReason}”</div>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {h.lastVisitAt ? `${fmtDayOf(h.lastVisitAt)}, ${fmtTime(h.lastVisitAt)}` : 'Not yet'}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {!h.verified && (
                        <Button size="sm" variant="ghost" loading={verify.isPending && verify.variables === h.id} onClick={() => verify.mutate(h.id)}>
                          Verify
                        </Button>
                      )}
                      {h.status === 'ACTIVE' ? (
                        <Button size="sm" variant="ghost" onClick={() => { setSuspending(h); setReason(''); }}>Suspend</Button>
                      ) : (
                        <Button size="sm" variant="ghost" loading={reinstate.isPending && reinstate.variables === h.id} onClick={() => reinstate.mutate(h.id)}>
                          Reinstate
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Card>
      <Pager meta={data?.meta} page={page} setPage={setPage} noun="people" />

      <Modal open={!!suspending} onClose={() => !suspend.isPending && setSuspending(null)} title="Suspend household help">
        {suspending && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{suspending.name}</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[suspending.role]} · works for {suspending.flatCodes.join(', ') || 'no flat'}</p>
            </div>
            <p className="text-xs text-slate-500">
              The gate will not let them in until you reinstate them. The households that employ them are told, with your reason, which is also kept in the audit trail.
            </p>
            <Textarea label="Reason (required)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Reported by two residents" />
            <div className="flex justify-end gap-3">
              <Button variant="outline" disabled={suspend.isPending} onClick={() => setSuspending(null)}>Cancel</Button>
              <Button variant="danger" disabled={reason.trim().length < 3} loading={suspend.isPending} onClick={() => suspend.mutate({ id: suspending.id, why: reason.trim() })}>
                Suspend
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Attendance() {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const filters = { search: search.trim() || undefined, from: from || undefined, to: to || undefined };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['helper-attendance', filters, page],
    queryFn: () => helpersApi.visits({ ...filters, page, limit: 25 }).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const anyFilter = !!(search || from || to);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_9rem_auto]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
            placeholder="Name"
            aria-label="Search attendance by name"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
        <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
        {anyFilter && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFrom(''); setTo(''); setPage(1); }}>Clear</Button>}
      </div>

      <Card padding="none">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : isError ? (
          <EmptyState icon={UserCheck} title="Could not load attendance" description="Check your connection and refresh the page." />
        ) : !data?.data.length ? (
          <EmptyState icon={UserCheck} title={anyFilter ? 'No visits match' : 'No visits yet'} description={anyFilter ? 'Try different filters.' : 'Visits appear here once a guard lets someone in at the gate.'} />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Date (IST)</Th>
                <Th>Person</Th>
                <Th>Works for</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th>Time inside</Th>
                <Th>Handled by</Th>
              </Tr>
            </Thead>
            <Tbody>
              {data.data.map((v) => (
                <Tr key={v.id}>
                  <Td className="whitespace-nowrap font-medium text-slate-900">{fmtDayOf(v.checkedInAt)}</Td>
                  <Td>
                    <div className="font-medium text-slate-900">{v.name}</div>
                    <div className="text-xs text-slate-500">{ROLE_LABEL[v.role]}</div>
                  </Td>
                  <Td className="text-sm">{v.flatCodes.join(', ') || '—'}</Td>
                  <Td className="whitespace-nowrap text-sm">{fmtTime(v.checkedInAt)}<div className="text-xs text-slate-500">{v.method === 'CODE' ? 'By pass code' : 'Picked by guard'}</div></Td>
                  <Td className="whitespace-nowrap text-sm">
                    {v.autoClosed ? <Badge variant="warning">Exit not recorded</Badge> : v.checkedOutAt ? fmtTime(v.checkedOutAt) : <Badge variant="success">Inside</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap text-sm">{duration(v)}</Td>
                  <Td className="text-xs text-slate-600">
                    {v.checkedInBy && <div>In: {v.checkedInBy}</div>}
                    {v.checkedOutBy && <div>Out: {v.checkedOutBy}</div>}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
      <Pager meta={data?.meta} page={page} setPage={setPage} noun="visits" />
    </>
  );
}

export default function HouseholdHelpPage() {
  const [tab, setTab] = useState<Tab>('register');
  return (
    <>
      <Header title="Household help" subtitle="Maids, cooks, drivers and others who work in the society's homes" />
      <PageContainer className="space-y-4">
        <div role="tablist" className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {(['register', 'attendance'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {t === 'register' ? 'Register' : 'Attendance'}
            </button>
          ))}
        </div>
        {tab === 'register' ? <Register /> : <Attendance />}
      </PageContainer>
    </>
  );
}
