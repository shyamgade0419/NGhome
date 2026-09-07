'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, CalendarDays, FileText, X, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { meetingsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';

function AddMeetingModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    meetingDate: new Date().toISOString().split('T')[0],
    location: '',
    agenda: '',
  });

  const mutation = useMutation({
    mutationFn: () => meetingsApi.create({
      title: form.title.trim(),
      meetingDate: new Date(form.meetingDate).toISOString(),
      location: form.location.trim() || undefined,
      agenda: form.agenda.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Meeting scheduled');
      qc.invalidateQueries({ queryKey: ['meetings'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create meeting'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Schedule Meeting</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Input label="Title *" placeholder="Annual General Meeting" value={form.title} onChange={set('title')} />
          <Input label="Date *" type="date" value={form.meetingDate} onChange={set('meetingDate')} />
          <Input label="Location" placeholder="Society Hall, Zoom link…" value={form.location} onChange={set('location')} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Agenda</label>
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              rows={4}
              placeholder="1. Approve last minutes&#10;2. Maintenance budget discussion&#10;3. Any other business"
              value={form.agenda}
              onChange={set('agenda')}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.title.trim()}>
            Schedule
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddMinutesModal({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');

  const mutation = useMutation({
    mutationFn: () => meetingsApi.addMinutes(meetingId, {
      content: content.trim(),
      summary: summary.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Minutes saved');
      qc.invalidateQueries({ queryKey: ['meetings'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to save minutes'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Meeting Minutes</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Summary (optional)</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="Key decisions made…"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Full Minutes *</label>
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              rows={8}
              placeholder="Detailed notes from the meeting…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!content.trim()}>
            Save Minutes
          </Button>
        </div>
      </div>
    </div>
  );
}

function MeetingCard({ meeting, admin }: { meeting: any; admin: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showMinutes, setShowMinutes] = useState(false);
  // Meeting.minutes is a one-to-one relation (MeetingMinutes?, unique on
  // meetingId) — a single object or null, never an array. `.length` on an
  // object is always undefined, so hasMinutes was always false: "Add
  // Minutes" showed even when minutes already existed, and the .map()
  // below that would render them never ran, so nobody — admin or
  // resident — could ever actually read a meeting's minutes here.
  const hasMinutes = !!meeting.minutes;

  const publish = useMutation({
    mutationFn: () => meetingsApi.publish(meeting.id),
    onSuccess: () => {
      toast.success('Residents can now read these minutes');
      qc.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to publish'),
  });

  return (
    <>
      {showMinutes && <AddMinutesModal meetingId={meeting.id} onClose={() => setShowMinutes(false)} />}
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-100">
              <CalendarDays size={18} className="text-primary-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">{meeting.title}</p>
              <p className="text-sm text-slate-500">{formatDate(meeting.meetingDate)}{meeting.location ? ` · ${meeting.location}` : ''}</p>
              {meeting.attendeeCount > 0 && (
                <p className="mt-0.5 text-xs text-slate-400">{meeting.attendeeCount} attendees</p>
              )}
              {admin && (
                <span className={cn(
                  'mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium',
                  meeting.isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                )}>
                  {meeting.isPublished ? 'Published to residents' : hasMinutes ? 'Minutes due to be published' : 'Scheduled'}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {admin && (
              <Button size="sm" variant="secondary" onClick={() => setShowMinutes(true)}>
                <FileText size={13} className="mr-1" /> {hasMinutes ? 'Edit Minutes' : 'Add Minutes'}
              </Button>
            )}
            {admin && hasMinutes && !meeting.isPublished && (
              <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending}>
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </Button>
            )}
            {(meeting.agenda || hasMinutes) && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
            {meeting.agenda && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Agenda</p>
                <p className="text-sm text-slate-700 whitespace-pre-line">{meeting.agenda}</p>
              </div>
            )}
            {hasMinutes && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Minutes</p>
                {meeting.minutes.summary && <p className="text-sm font-medium text-slate-800 mb-1">{meeting.minutes.summary}</p>}
                <p className="text-sm text-slate-700 whitespace-pre-line">{meeting.minutes.content}</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

export default function MeetingsPage() {
  const { user, activeMembership } = useAuth();
  const [showAdd, setShowAdd] = useState(false);

  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN' || !!user?.isPlatformAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: () => meetingsApi.list().then((r: any) => r.data ?? r),
  });

  const meetings: any[] = Array.isArray(data) ? data : (data?.data ?? []);

  return (
    <>
      {showAdd && <AddMeetingModal onClose={() => setShowAdd(false)} />}
      <Header
        title="Meetings"
        actions={isAdmin ? (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={15} className="mr-1.5" /> Schedule Meeting
          </Button>
        ) : undefined}
      />
      <PageContainer>
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : meetings.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No meetings yet"
            description={isAdmin ? 'Schedule your first society meeting.' : 'No meetings have been scheduled.'}
            action={isAdmin ? <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" /> Schedule</Button> : undefined}
          />
        ) : (
          <div className="space-y-3">
            {meetings.map((m: any) => (
              <MeetingCard key={m.id} meeting={m} admin={isAdmin} />
            ))}
          </div>
        )}
      </PageContainer>
    </>
  );
}
