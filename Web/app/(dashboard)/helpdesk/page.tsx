'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Wrench, X, ChevronDown, ChevronRight,
  Clock, CheckCircle2, AlertCircle, XCircle, MessageSquare, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { helpdeskApi, HelpdeskComment } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatDate, formatDateTime, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'PLUMBING', label: 'Plumbing' },
  { value: 'ELECTRICAL', label: 'Electrical' },
  { value: 'CIVIL', label: 'Civil / Structure' },
  { value: 'CLEANING', label: 'Cleaning' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'ELEVATOR', label: 'Elevator / Lift' },
  { value: 'CARPENTRY', label: 'Carpentry' },
  { value: 'PEST_CONTROL', label: 'Pest Control' },
  { value: 'OTHER', label: 'Other' },
];

const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

function statusBadge(status: string) {
  const map: Record<string, { variant: any; icon: React.ReactNode; label: string }> = {
    OPEN: { variant: 'warning', icon: <Clock size={11} />, label: 'Open' },
    IN_PROGRESS: { variant: 'info', icon: <AlertCircle size={11} />, label: 'In Progress' },
    RESOLVED: { variant: 'success', icon: <CheckCircle2 size={11} />, label: 'Resolved' },
    CLOSED: { variant: 'muted', icon: <XCircle size={11} />, label: 'Closed' },
  };
  const s = map[status] ?? { variant: 'default', icon: null, label: status };
  return (
    <Badge variant={s.variant}>
      <span className="flex items-center gap-1">{s.icon}{s.label}</span>
    </Badge>
  );
}

function priorityBadge(p: string) {
  const map: Record<string, any> = { LOW: 'muted', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };
  return <Badge variant={map[p] ?? 'default'}>{p}</Badge>;
}

function NewRequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '', description: '', category: 'OTHER', priority: 'MEDIUM',
  });

  const mutation = useMutation({
    mutationFn: () => helpdeskApi.create({
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      category: form.category,
      priority: form.priority,
    }),
    onSuccess: () => {
      toast.success('Request submitted');
      qc.invalidateQueries({ queryKey: ['helpdesk'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to submit'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">New Maintenance Request</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Input label="Title *" placeholder="Water leaking from tap in bathroom" value={form.title} onChange={set('title')} />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Category" value={form.category} onChange={set('category')}
              options={CATEGORIES.filter(c => c.value).map(c => ({ value: c.value, label: c.label }))} />
            <Select label="Priority" value={form.priority} onChange={set('priority')} options={PRIORITIES} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              rows={4}
              placeholder="Describe the issue in detail, including location…"
              value={form.description}
              onChange={set('description')}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.title.trim()}>
            Submit Request
          </Button>
        </div>
      </div>
    </div>
  );
}

function UpdateStatusModal({ request, onClose }: { request: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    status: request.status,
    adminNotes: request.adminNotes ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => helpdeskApi.updateStatus(request.id, {
      status: form.status,
      adminNotes: form.adminNotes.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['helpdesk'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Update Request</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm font-medium text-slate-700 truncate">{request.title}</p>
        <div className="space-y-4">
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            options={STATUSES.filter(s => s.value).map(s => ({ value: s.value, label: s.label }))}
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Admin Notes</label>
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              rows={3}
              placeholder="Update for resident — what was done, ETA, etc."
              value={form.adminNotes}
              onChange={(e) => setForm((f) => ({ ...f, adminNotes: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
            Save Update
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The conversation on a request, shown inside the card's expansion.
 *
 * Requests were one-way — the resident raised one and watched the status,
 * with adminNotes as the only channel back. Both sides now post here. Lines
 * are placed by who raised the request, not who is looking, so the thread
 * reads the same on the admin's screen and the resident's.
 */
function RequestThreadPanel({ req }: { req: any }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  const { data: comments, isLoading } = useQuery({
    queryKey: ['helpdesk-comments', req.id],
    queryFn: () => helpdeskApi.comments(req.id).then((r: any) => (r.data?.data ?? r.data) as HelpdeskComment[]),
  });

  const send = useMutation({
    mutationFn: () => helpdeskApi.addComment(req.id, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['helpdesk-comments', req.id] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e?.response?.data?.message ?? 'Could not send reply'),
  });

  const closed = req.status === 'CLOSED';
  const thread = comments ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversation</p>

      <div className="space-y-2">
        <div className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-primary-50 px-3 py-2">
          <p className="text-[11px] text-slate-500">
            {req.resident ? `${req.resident.firstName} ${req.resident.lastName}` : 'Resident'} ·{' '}
            {formatDateTime(req.createdAt)}
          </p>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">
            {req.description?.trim() || req.title}
          </p>
        </div>

        {req.adminNotes && (
          <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] text-slate-500">Society note</p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap">{req.adminNotes}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-2"><Spinner /></div>
        ) : (
          thread.map((c) => (
            <div
              key={c.id}
              className={cn(
                'max-w-[85%] rounded-xl px-3 py-2',
                c.isFromResident
                  ? 'ml-auto rounded-br-sm bg-primary-50'
                  : 'rounded-bl-sm border border-slate-200 bg-white',
              )}
            >
              <p className="text-[11px] text-slate-500">
                {c.author.firstName} {c.author.lastName}
                {c.isFromResident ? '' : ' · Society'} · {formatDateTime(c.createdAt)}
              </p>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))
        )}

        {!isLoading && thread.length === 0 && !req.adminNotes && (
          <p className="py-1 text-center text-xs text-slate-400">
            No replies yet. Anything added here goes to the other side straight away.
          </p>
        )}
      </div>

      {closed ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          This request is closed. Raise a new one if the problem has come back.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) send.mutate();
          }}
          className="flex items-end gap-2 pt-1"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a line — the chat convention.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) send.mutate();
              }
            }}
            placeholder="Write a reply…"
            rows={2}
            maxLength={2000}
            aria-label="Reply"
            className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Button type="submit" size="sm" loading={send.isPending} disabled={!draft.trim()}>
            <Send size={13} /> Send
          </Button>
        </form>
      )}
    </div>
  );
}

function RequestCard({ req, admin }: { req: any; admin: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);

  return (
    <>
      {showUpdate && <UpdateStatusModal request={req} onClose={() => setShowUpdate(false)} />}
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 p-4">
          <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${req.priority === 'URGENT' ? 'bg-red-100' : req.priority === 'HIGH' ? 'bg-amber-100' : 'bg-slate-100'}`}>
            <Wrench size={16} className={req.priority === 'URGENT' ? 'text-red-500' : req.priority === 'HIGH' ? 'text-amber-500' : 'text-slate-500'} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <p className="font-semibold text-slate-900 truncate">{req.title}</p>
              {priorityBadge(req.priority)}
              {statusBadge(req.status)}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {req.category !== 'OTHER' && <span className="rounded bg-slate-100 px-1.5 py-0.5">{req.category.replace('_', ' ')}</span>}
              {admin && req.resident && <span>{req.resident.firstName} {req.resident.lastName}</span>}
              {req.flat && <span>Flat {req.flat.unitNumber}</span>}
              <span>{formatDate(req.createdAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {admin && req.status !== 'CLOSED' && (
              <Button size="sm" variant="secondary" onClick={() => setShowUpdate(true)}>
                Update
              </Button>
            )}
            {/* Always offered now, not only when there was a description or a
                note: the conversation is always worth opening, even to start it. */}
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              aria-expanded={expanded}
            >
              <MessageSquare size={14} />
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-slate-100 bg-slate-50/60 px-4 pb-4 pt-3 space-y-2">
            {req.resolvedAt && (
              <p className="text-xs text-slate-400">Resolved: {formatDateTime(req.resolvedAt)}</p>
            )}
            <RequestThreadPanel req={req} />
          </div>
        )}
      </Card>
    </>
  );
}

export default function HelpdeskPage() {
  const { user, activeMembership } = useAuth();
  const [showNew, setShowNew] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN' ||
    activeMembership?.role === 'SOCIETY_STAFF' || !!user?.isPlatformAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ['helpdesk', filterStatus, filterCategory],
    queryFn: () => helpdeskApi.list({
      status: (filterStatus as any) || undefined,
      category: filterCategory || undefined,
      limit: 100,
    }).then((r: any) => r.data ?? r),
  });

  const requests: any[] = Array.isArray(data) ? data : (data?.data ?? []);

  const open = requests.filter(r => r.status === 'OPEN').length;
  const inProgress = requests.filter(r => r.status === 'IN_PROGRESS').length;

  return (
    <>
      {showNew && <NewRequestModal onClose={() => setShowNew(false)} />}
      <Header
        title="Helpdesk"
        actions={
          <div className="flex items-center gap-2">
            <Select label="" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} options={STATUSES} className="w-36" />
            <Select label="" value={filterCategory} onChange={e => setFilterCategory(e.target.value)} options={CATEGORIES} className="w-40" />
            <Button size="sm" onClick={() => setShowNew(true)}>
              <Plus size={14} className="mr-1" /> New Request
            </Button>
          </div>
        }
      />
      <PageContainer>
        {/* Summary row (admin only) */}
        {isAdmin && !filterStatus && !filterCategory && (
          <div className="mb-4 flex gap-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
              <span className="font-semibold text-amber-700">{open}</span>
              <span className="text-amber-600 ml-1">Open</span>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm">
              <span className="font-semibold text-blue-700">{inProgress}</span>
              <span className="text-blue-600 ml-1">In Progress</span>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No maintenance requests"
            description={isAdmin ? 'Resident requests will appear here.' : 'No issues reported yet. Tap + to raise one.'}
            action={<Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} className="mr-1" /> New Request</Button>}
          />
        ) : (
          <div className="space-y-3">
            {requests.map((req: any) => (
              <RequestCard key={req.id} req={req} admin={isAdmin} />
            ))}
          </div>
        )}
      </PageContainer>
    </>
  );
}
