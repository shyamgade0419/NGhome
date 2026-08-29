'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, Send, X } from 'lucide-react';
import { notificationsApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn, formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';

/* ─── Compose Modal (admin/staff only) ───────────────────────────── */
function ComposeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', message: '' });

  const mutation = useMutation({
    mutationFn: () =>
      notificationsApi.send({
        title: form.title.trim(),
        message: form.message.trim(),
      }),
    onSuccess: () => {
      toast.success('Notification sent to all members');
      qc.invalidateQueries({ queryKey: ['notifications-mine'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to send'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Send Notification</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">
          <Input
            label="Title *"
            placeholder="Maintenance reminder"
            value={form.title}
            onChange={set('title')}
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Message *</label>
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 min-h-[100px]"
              placeholder="Write your message to all society members..."
              value={form.message}
              onChange={set('message')}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.title.trim() || !form.message.trim()}
          >
            <Send size={14} className="mr-1.5" /> Send to All Members
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────── */
export default function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCompose, setShowCompose] = useState(false);
  const canSend = user?.currentRole === 'SOCIETY_ADMIN' || user?.currentRole === 'SOCIETY_STAFF';

  const { data, isLoading } = useQuery({
    queryKey: ['notifications-mine'],
    queryFn: () => notificationsApi.listMine({ limit: 50 }).then((r: any) => r.data ?? r),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications-mine'] }),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const notifications: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <>
      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}

      <Header
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        actions={
          canSend ? (
            <Button size="sm" onClick={() => setShowCompose(true)}>
              <Send size={14} className="mr-1.5" /> Compose
            </Button>
          ) : undefined
        }
      />

      <PageContainer>
        {isLoading ? (
          <PageSpinner />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="You'll see society announcements and billing alerts here."
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {notifications.map((n: any, i: number) => (
              <div
                key={n.id}
                className={cn(
                  'flex items-start gap-4 px-5 py-4',
                  i !== 0 && 'border-t border-slate-100',
                  !n.isRead && 'bg-primary-50/30',
                )}
              >
                {/* Icon */}
                <div className={cn(
                  'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                  n.isRead ? 'bg-slate-100' : 'bg-primary-100',
                )}>
                  <Bell size={14} className={n.isRead ? 'text-slate-400' : 'text-primary-600'} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn('text-sm', n.isRead ? 'font-medium text-slate-700' : 'font-semibold text-slate-900')}>
                      {n.title}
                    </p>
                    <span className="flex-shrink-0 text-xs text-slate-400">
                      {formatDateTime(n.createdAt)}
                    </span>
                  </div>
                  {n.message && (
                    <p className="mt-0.5 text-sm text-slate-500">{n.message}</p>
                  )}
                  {n.type && (
                    <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {n.type.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {/* Mark read */}
                {!n.isRead && (
                  <button
                    onClick={() => markReadMutation.mutate(n.id)}
                    disabled={markReadMutation.isPending}
                    className="flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-white hover:text-primary-600 transition-colors"
                    title="Mark as read"
                  >
                    <Check size={15} />
                  </button>
                )}
                {n.isRead && (
                  <CheckCheck size={14} className="flex-shrink-0 mt-1 text-slate-300" />
                )}
              </div>
            ))}
          </div>
        )}
      </PageContainer>
    </>
  );
}
