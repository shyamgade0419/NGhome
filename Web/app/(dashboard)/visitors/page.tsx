'use client';

/**
 * Committee: the gate log. Who came, for which flat, who answered and who let
 * them in. A request nobody answered can be decided here, but only with a
 * reason — it goes in the audit trail and the flat's residents are told. The
 * visitor rules (whether walk-ins need approval, how long invitations last)
 * live behind the "Visitor rules" button.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Search, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { visitorsApi } from '@/lib/api/endpoints';
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
import { fmtDayOf, fmtTime } from '@/lib/amenities';
import {
  ENTRY_STATUS, METHOD_LABEL, POLICY_LIMITS, STATUS_OPTIONS, TYPE_OPTIONS, canOverride, typeLabel,
  type VisitorEntryStatus, type VisitorLogEntry, type VisitorPolicy, type VisitorType,
} from '@/lib/visitors';

const errorMessage = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

function PolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['visitor-policy'], queryFn: () => visitorsApi.policy().then((r) => r.data), enabled: open });
  const [draft, setDraft] = useState<VisitorPolicy | null>(null);
  const shown = draft ?? data ?? null;

  const save = useMutation({
    mutationFn: (p: VisitorPolicy) => visitorsApi.updatePolicy(p),
    onSuccess: () => {
      toast.success('Visitor rules saved');
      qc.invalidateQueries({ queryKey: ['visitor-policy'] });
      setDraft(null);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the rules')),
  });

  const num = (key: 'maxInviteDays' | 'maxUsesPerInvite' | 'approvalWindowMinutes', label: string, hint: string) => {
    const { min, max } = POLICY_LIMITS[key];
    return (
      <Input
        label={label}
        type="number"
        min={min}
        max={max}
        value={shown?.[key] ?? ''}
        hint={`${hint} (${min}–${max})`}
        onChange={(e) => shown && setDraft({ ...shown, [key]: Number(e.target.value) })}
      />
    );
  };

  return (
    <Modal open={open} onClose={() => { setDraft(null); onClose(); }} title="Visitor rules">
      {!shown ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <Select
            label="Visitors who arrive without an invitation"
            value={shown.walkInApproval}
            options={[
              { value: 'REQUIRED', label: 'A resident must approve each one' },
              { value: 'NOT_REQUIRED', label: 'Let them in without asking' },
            ]}
            onChange={(e) => setDraft({ ...shown, walkInApproval: e.target.value as VisitorPolicy['walkInApproval'] })}
          />
          {shown.walkInApproval === 'NOT_REQUIRED' && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Residents are still told who arrived, but nobody can stop an unwanted visitor at the gate. Most societies keep approval on.
            </p>
          )}
          {num('maxInviteDays', 'Longest an invitation can last (days)', 'Guests with a code walk straight in')}
          {num('maxUsesPerInvite', 'Entries one invitation can admit', 'For a family or a party')}
          {num('approvalWindowMinutes', 'Time a resident has to answer (minutes)', 'After this a request lapses')}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setDraft(null); onClose(); }}>Cancel</Button>
            <Button loading={save.isPending} disabled={!draft} onClick={() => draft && save.mutate(draft)}>Save rules</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function VisitorsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | VisitorEntryStatus>('');
  const [type, setType] = useState<'' | VisitorType>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [deciding, setDeciding] = useState<VisitorLogEntry | null>(null);
  const [reason, setReason] = useState('');

  const filters = { status: status || undefined, visitorType: type || undefined, search: search.trim() || undefined, from: from || undefined, to: to || undefined };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['visitor-log', filters, page],
    queryFn: () => visitorsApi.log({ ...filters, page, limit: 25 }).then((r) => r.data),
    refetchInterval: 20_000,
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'APPROVE' | 'REJECT' }) => visitorsApi.override(id, action, reason.trim()),
    onSuccess: () => {
      toast.success('Decision recorded. The residents have been told.');
      qc.invalidateQueries({ queryKey: ['visitor-log'] });
      setDeciding(null);
      setReason('');
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['visitor-log'] });
      toast.error(errorMessage(e, 'Could not record the decision'));
    },
  });

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const anyFilter = !!(status || type || search || from || to);

  return (
    <>
      <Header
        title="Visitors"
        subtitle="Gate log"
        actions={
          <Button size="sm" variant="outline" onClick={() => setPolicyOpen(true)}>
            <Settings2 size={14} /> Visitor rules
          </Button>
        }
      />
      <PageContainer className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_9rem_9rem_9rem_auto]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => reset(setSearch)(e.target.value)}
              placeholder="Name, phone, vehicle or flat"
              aria-label="Search visitors"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <Select aria-label="Status" options={STATUS_OPTIONS} value={status} onChange={(e) => reset(setStatus)(e.target.value as '' | VisitorEntryStatus)} />
          <Select aria-label="Type" options={TYPE_OPTIONS} value={type} onChange={(e) => reset(setType)(e.target.value as '' | VisitorType)} />
          <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
          <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setStatus(''); setType(''); setSearch(''); setFrom(''); setTo(''); setPage(1); }}>
              Clear
            </Button>
          )}
        </div>

        <Card padding="none">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : isError ? (
            <EmptyState icon={DoorOpen} title="Could not load the gate log" description="Check your connection and refresh the page." />
          ) : !data?.data.length ? (
            <EmptyState
              icon={DoorOpen}
              title={anyFilter ? 'No visitors match' : 'No visitors yet'}
              description={anyFilter ? 'Try different filters.' : 'Visitors appear here once a guard registers them or a guest uses an invitation code.'}
            />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>When (IST)</Th>
                  <Th>Visitor</Th>
                  <Th>Flat</Th>
                  <Th>Status</Th>
                  <Th>Handled by</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {data.data.map((v) => {
                  const s = ENTRY_STATUS[v.status];
                  return (
                    <Tr key={v.id}>
                      <Td className="whitespace-nowrap">
                        <div className="font-medium text-slate-900">{fmtDayOf(v.requestedAt)}</div>
                        <div className="text-xs text-slate-500">
                          {fmtTime(v.requestedAt)}
                          {v.checkedInAt ? ` · in ${fmtTime(v.checkedInAt)}` : ''}
                          {v.checkedOutAt ? ` · out ${fmtTime(v.checkedOutAt)}` : ''}
                        </div>
                      </Td>
                      <Td>
                        <div className="font-medium text-slate-900">{v.visitorName}</div>
                        <div className="text-xs text-slate-500">
                          {typeLabel(v.visitorType)}
                          {v.visitorPhone ? ` · ${v.visitorPhone}` : ''}
                          {v.vehicleNumber ? ` · ${v.vehicleNumber}` : ''}
                        </div>
                        {v.purpose && <div className="text-xs text-slate-500">{v.purpose}</div>}
                      </Td>
                      <Td className="font-medium">{v.flatCode ?? '—'}</Td>
                      <Td>
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {v.decisionMethod && <div className="mt-1 text-xs text-slate-500">{METHOD_LABEL[v.decisionMethod]}</div>}
                        {v.decisionNote && <div className="text-xs italic text-slate-500">“{v.decisionNote}”</div>}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {v.registeredBy && <div>Registered: {v.registeredBy}</div>}
                        {v.decidedBy && <div>Answered: {v.decidedBy}</div>}
                        {v.checkedInBy && <div>Let in: {v.checkedInBy}</div>}
                        {v.checkedOutBy && <div>Out: {v.checkedOutBy}</div>}
                      </Td>
                      <Td className="text-right">
                        {canOverride(v.status) && (
                          <Button size="sm" variant="ghost" onClick={() => { setDeciding(v); setReason(''); }}>
                            Decide
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

        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{data.meta.total} visits</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </PageContainer>

      <Modal open={!!deciding} onClose={() => !decide.isPending && setDeciding(null)} title="Decide as committee">
        {deciding && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{deciding.visitorName}</p>
              <p className="text-xs text-slate-500">
                Flat {deciding.flatCode} · {typeLabel(deciding.visitorType)} · {fmtDayOf(deciding.requestedAt)}, {fmtTime(deciding.requestedAt)}
              </p>
            </div>
            <p className="text-xs text-slate-500">
              The residents of that flat are told the committee stepped in, and your reason is kept in the audit trail.
            </p>
            <Textarea label="Reason (required)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Plumber the committee arranged" />
            <div className="flex justify-end gap-3">
              <Button variant="outline" disabled={reason.trim().length < 3} loading={decide.isPending && decide.variables?.action === 'REJECT'} onClick={() => decide.mutate({ id: deciding.id, action: 'REJECT' })}>
                Decline
              </Button>
              <Button disabled={reason.trim().length < 3} loading={decide.isPending && decide.variables?.action === 'APPROVE'} onClick={() => decide.mutate({ id: deciding.id, action: 'APPROVE' })}>
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <PolicyModal open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </>
  );
}
