'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Megaphone, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { communityApi } from '@/lib/api/endpoints';
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
import { formatDateTime } from '@/lib/utils';
import { Announcement } from '@/lib/types';
import { useAuth } from '@/lib/auth/AuthContext';

const schema = z.object({
  title: z.string().min(1, 'Title required'),
  content: z.string().min(1, 'Content required'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  expiresAt: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const priorityVariant = (p: string) => {
  const m: Record<string, 'default' | 'info' | 'warning' | 'danger'> = {
    LOW: 'default', NORMAL: 'info', HIGH: 'warning', URGENT: 'danger',
  };
  return m[p] ?? 'default';
};

const ADMIN_ROLES = ['SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT', 'SOCIETY_STAFF', 'PLATFORM_ADMIN'];

export default function CommunityPage() {
  const qc = useQueryClient();
  const { user, activeMembership } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const isAdmin = ADMIN_ROLES.includes(activeMembership?.role ?? '') || !!user?.isPlatformAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => communityApi.listAnnouncements({ limit: 50 }).then((r) => r.data),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { priority: 'NORMAL' },
  });

  const createMutation = useMutation({
    mutationFn: (d: FormData) => communityApi.createAnnouncement(d),
    onSuccess: () => {
      toast.success('Announcement published');
      qc.invalidateQueries({ queryKey: ['announcements'] });
      setShowModal(false);
      reset();
    },
    onError: () => toast.error('Failed to publish'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => communityApi.deleteAnnouncement(id),
    onSuccess: () => {
      toast.success('Announcement deleted');
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: () => toast.error('Failed to delete'),
  });

  const announcements = data?.data ?? [];

  return (
    <>
      <Header
        title="Community"
        subtitle="Announcements & notices"
        actions={
          isAdmin ? (
            <Button onClick={() => setShowModal(true)} size="sm">
              <Plus size={14} /> New Announcement
            </Button>
          ) : undefined
        }
      />
      <PageContainer className="space-y-6">
        {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}

        {!isLoading && announcements.length === 0 && (
          <EmptyState
            icon={Megaphone}
            title="No announcements yet"
            description="Post your first announcement to notify all residents"
            action={
              isAdmin ? (
                <Button onClick={() => setShowModal(true)} size="sm"><Plus size={14} /> Create Announcement</Button>
              ) : undefined
            }
          />
        )}

        {announcements.length > 0 && (
          <div className="space-y-3">
            {announcements.map((a) => (
              <AnnouncementCard
                key={a.id}
                announcement={a}
                canDelete={isAdmin}
                onDelete={() => deleteMutation.mutate(a.id)}
              />
            ))}
          </div>
        )}
      </PageContainer>

      <Modal open={showModal} onClose={() => { setShowModal(false); reset(); }} title="New Announcement" size="lg">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
          <Input label="Title" placeholder="Announcement title" error={errors.title?.message} {...register('title')} />
          <Textarea label="Content" placeholder="Write your announcement…" rows={5} error={errors.content?.message} {...register('content')} />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Priority"
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'NORMAL', label: 'Normal' },
                { value: 'HIGH', label: 'High' },
                { value: 'URGENT', label: 'Urgent' },
              ]}
              error={errors.priority?.message}
              {...register('priority')}
            />
            <Input label="Expires at (optional)" type="datetime-local" {...register('expiresAt')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowModal(false); reset(); }}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Publish</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function AnnouncementCard({
  announcement: a,
  canDelete,
  onDelete,
}: {
  announcement: Announcement;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <Card padding="lg" className="flex gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-slate-900 truncate">{a.title}</h3>
          <Badge variant={priorityVariant(a.priority)}>{a.priority}</Badge>
        </div>
        <p className="text-sm text-slate-600 whitespace-pre-wrap">{a.content}</p>
        <p className="mt-2 text-xs text-slate-400">
          {formatDateTime(a.publishedAt ?? a.createdAt)}
          {a.expiresAt && ` · Expires ${formatDateTime(a.expiresAt)}`}
        </p>
      </div>
      {canDelete && (
        <button
          onClick={onDelete}
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          title="Delete"
        >
          <Trash2 size={15} />
        </button>
      )}
    </Card>
  );
}
