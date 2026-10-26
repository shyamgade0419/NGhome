'use client';

/**
 * Every society on the platform, with status filters, search and the
 * suspend / reinstate action. Suspending is confirmed in a dialog: it cuts off
 * a whole society's residents, and the row a cursor lands on is not always the
 * one that was meant. Nothing is deleted either way.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, Mail, Phone, RotateCcw, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi, PlatformSociety } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { DButton, DModal, DTable, Empty, Loading, PageHeader, Pill, TableWrap, Td } from '@/components/platform/ui';
import { formatDate, cn } from '@/lib/utils';

type Filter = 'all' | 'active' | 'suspended' | 'deleted';

/** How a society is removed: hidden with its data kept, or erased for good. */
type DeleteMode = 'soft' | 'hard';

export default function PlatformSocietiesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState<PlatformSociety | null>(null);
  const [deleting, setDeleting] = useState<PlatformSociety | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteMode, setDeleteMode] = useState<DeleteMode>('soft');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-societies'],
    queryFn: () => platformApi.listSocieties({ limit: 100 }).then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  // Societies that were removed with 'keep the data'. They are not in the list
  // above, so this is the only place they can be erased for good.
  const { data: deletedData } = useQuery({
    queryKey: ['platform-societies-deleted'],
    queryFn: () => platformApi.listSocieties({ limit: 100, deleted: true }).then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => platformApi.setSocietyStatus(id, isActive),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['platform-societies'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      toast.success(vars.isActive ? 'Society reinstated' : 'Society suspended');
      setConfirming(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update society'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => platformApi.deleteSociety(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-societies'] });
      qc.invalidateQueries({ queryKey: ['platform-societies-deleted'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      toast.success('Society removed — its data is kept');
      closeDelete();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete society'),
  });

  const purge = useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) => platformApi.purgeSociety(id, confirmName),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['platform-societies'] });
      qc.invalidateQueries({ queryKey: ['platform-societies-deleted'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      const people = res.data.usersRemoved;
      toast.success(`Erased permanently${people ? ` — ${people} account${people === 1 ? '' : 's'} removed` : ''}`);
      closeDelete();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not erase the society — nothing was deleted'),
  });

  function closeDelete() {
    setDeleting(null);
    setDeleteConfirmText('');
    setDeleteMode('soft');
  }

  /** A society that is already hidden can only be erased, so skip the choice. */
  function openDelete(s: PlatformSociety, mode: DeleteMode) {
    setDeleting(s);
    setDeleteConfirmText('');
    setDeleteMode(mode);
  }

  const all = useMemo(() => data?.data ?? [], [data]);
  const removed = useMemo(() => deletedData?.data ?? [], [deletedData]);
  const counts = {
    all: all.length,
    active: all.filter((s) => s.isActive).length,
    suspended: all.filter((s) => !s.isActive).length,
    deleted: removed.length,
  };
  const showingDeleted = filter === 'deleted';

  const societies = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (showingDeleted ? removed : all).filter((s) => {
      if (filter === 'active' && !s.isActive) return false;
      if (filter === 'suspended' && s.isActive) return false;
      if (!term) return true;
      return [s.name, s.displayName, s.city, s.joinCode, ...s.admins.map((a) => `${a.firstName} ${a.lastName} ${a.email}`)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [all, removed, showingDeleted, filter, search]);

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'suspended', label: 'Suspended' },
    { key: 'deleted', label: 'Deleted' },
  ];

  return (
    <PlatformShell>
      <PageHeader title="Societies" subtitle="All registered societies on the platform" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5" role="group" aria-label="Filter by status">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              aria-pressed={filter === c.key}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                filter === c.key
                  ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-800',
              )}
            >
              {c.label} <span className="ml-1 tabular-nums opacity-70">{counts[c.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search society, city, admin or code"
            aria-label="Search societies"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <Empty icon={Building2} title="Couldn't load societies" description="Try refreshing the page." />
      ) : societies.length === 0 ? (
        <Empty
          icon={Building2}
          title={showingDeleted ? 'No deleted societies' : all.length === 0 ? 'No societies yet' : 'No matching societies'}
          description={
            showingDeleted
              ? 'Societies you remove with "keep the data" are listed here, where they can be erased for good.'
              : all.length === 0
                ? 'Societies appear here once they register.'
                : 'Try another filter or search term.'
          }
        />
      ) : (
        <TableWrap>
          <DTable head={['Society', 'Admin contact', 'Members', 'Buildings', 'Join code', 'Status', 'Since', <span key="a" className="block text-right">Actions</span>]}>
            {societies.map((s) => (
              <tr key={s.id} className="hover:bg-gray-800/30">
                <Td>
                  <Link href={`/platform/${s.id}`} className="font-medium text-white hover:text-teal-300 hover:underline">
                    {s.displayName ?? s.name}
                  </Link>
                  {(s.city || s.state) && (
                    <p className="text-xs text-gray-500">{[s.city, s.state].filter(Boolean).join(', ')}</p>
                  )}
                </Td>
                <Td>
                  {s.admins.length === 0 ? (
                    <span className="text-xs text-gray-500">No admin found</span>
                  ) : (
                    <div className="space-y-2">
                      {s.admins.map((a) => (
                        <div key={a.id}>
                          <p className="text-sm text-gray-100">{a.firstName} {a.lastName}</p>
                          <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                            {a.phone && <span className="flex items-center gap-1"><Phone size={11} /> {a.phone}</span>}
                            <span className="flex items-center gap-1"><Mail size={11} /> {a.email}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Td>
                <Td className="tabular-nums">{s._count.memberships}</Td>
                <Td className="tabular-nums">{s._count.buildings}</Td>
                <Td>
                  {s.joinCode ? (
                    <code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-300">{s.joinCode}</code>
                  ) : (
                    <span className="text-xs text-gray-500">—</span>
                  )}
                </Td>
                <Td>
                  {showingDeleted ? (
                    <Pill tone="slate">Deleted</Pill>
                  ) : (
                    <Pill tone={s.isActive ? 'green' : 'red'}>{s.isActive ? 'Active' : 'Suspended'}</Pill>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-xs text-gray-400">{formatDate(s.createdAt)}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {showingDeleted ? (
                      <DButton size="sm" variant="danger" onClick={() => openDelete(s, 'hard')}>
                        <Trash2 size={13} /> Delete permanently
                      </DButton>
                    ) : (
                      <>
                        <DButton size="sm" onClick={() => setConfirming(s)}>
                          {s.isActive ? (
                            <><Ban size={13} /> Suspend</>
                          ) : (
                            <><RotateCcw size={13} /> Reinstate</>
                          )}
                        </DButton>
                        <DButton size="sm" variant="danger" aria-label="Delete society" onClick={() => openDelete(s, 'soft')}>
                          <Trash2 size={13} />
                        </DButton>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </DTable>
        </TableWrap>
      )}

      <DModal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming?.isActive ? 'Suspend society' : 'Reinstate society'}
      >
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              {confirming.isActive ? (
                <>
                  Suspend <strong className="text-white">{confirming.displayName ?? confirming.name}</strong>? Its{' '}
                  {confirming._count.memberships} member{confirming._count.memberships === 1 ? '' : 's'} will lose access.
                </>
              ) : (
                <>
                  Reinstate <strong className="text-white">{confirming.displayName ?? confirming.name}</strong>? Its
                  members get access back immediately.
                </>
              )}
            </p>
            <p className="rounded-lg bg-gray-800/60 px-3 py-2.5 text-xs text-gray-400">
              Nothing is deleted either way. Memberships, bills and history are kept, so a suspended society comes back
              exactly as it was.
            </p>
            {confirming.admins.length > 0 && confirming.isActive && (
              <p className="text-xs text-gray-400">
                Worth telling first: {confirming.admins.map((a) => `${a.firstName} ${a.lastName}`).join(', ')}
                {confirming.admins[0]?.email ? ` (${confirming.admins[0].email})` : ''}.
              </p>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <DButton onClick={() => setConfirming(null)}>Cancel</DButton>
              <DButton
                variant={confirming.isActive ? 'danger' : 'primary'}
                loading={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: confirming.id, isActive: !confirming.isActive })}
              >
                {confirming.isActive ? 'Suspend' : 'Reinstate'}
              </DButton>
            </div>
          </div>
        )}
      </DModal>

      <DModal
        open={!!deleting}
        onClose={() => !(remove.isPending || purge.isPending) && closeDelete()}
        title={deleteMode === 'hard' ? 'Delete society permanently' : 'Delete society'}
      >
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              <strong className="text-white">{deleting.displayName ?? deleting.name}</strong> has{' '}
              {deleting._count.memberships} member{deleting._count.memberships === 1 ? '' : 's'}.
            </p>

            {/* A society already hidden can only be erased, so there is nothing to choose. */}
            {!deleting.deletedAt && (
              <div role="radiogroup" aria-label="How to delete" className="space-y-2">
                {(
                  [
                    {
                      mode: 'soft' as const,
                      title: 'Remove from the platform — keep the data',
                      body: 'It disappears everywhere and nobody there can sign in. Memberships, bills, expenses, documents and history stay in the database, and the members’ email addresses stay taken.',
                    },
                    {
                      mode: 'hard' as const,
                      title: 'Delete permanently',
                      body: 'Erases the society and everything in it, for good. The accounts of people who belong to no other society are deleted too, which frees their email addresses. This cannot be undone.',
                    },
                  ]
                ).map((o) => (
                  <button
                    key={o.mode}
                    type="button"
                    role="radio"
                    aria-checked={deleteMode === o.mode}
                    onClick={() => setDeleteMode(o.mode)}
                    className={cn(
                      'w-full rounded-lg border px-3.5 py-3 text-left transition-colors',
                      deleteMode === o.mode
                        ? o.mode === 'hard'
                          ? 'border-red-500/60 bg-red-500/10'
                          : 'border-teal-500/50 bg-teal-500/10'
                        : 'border-gray-700 hover:bg-gray-800/60',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-white">
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border',
                          deleteMode === o.mode ? (o.mode === 'hard' ? 'border-red-400' : 'border-teal-400') : 'border-gray-600',
                        )}
                      >
                        {deleteMode === o.mode && (
                          <span className={cn('h-2 w-2 rounded-full', o.mode === 'hard' ? 'bg-red-400' : 'bg-teal-400')} />
                        )}
                      </span>
                      {o.title}
                    </span>
                    <span className="mt-1 block pl-6 text-xs leading-relaxed text-gray-400">{o.body}</span>
                  </button>
                ))}
              </div>
            )}

            {deleteMode === 'hard' && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-200">
                Everything is erased: members, flats, bills, payments, expenses, accounts, documents and their stored
                files, forum posts, messages and the society&rsquo;s audit history. Only a record that this was done, and
                by whom, is kept.
              </div>
            )}

            <div>
              <label htmlFor="confirm-name" className="mb-1 block text-xs font-medium text-gray-300">
                Type <span className="font-mono text-gray-200">{deleting.displayName ?? deleting.name}</span> to confirm
              </label>
              <input
                id="confirm-name"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoComplete="off"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <DButton onClick={closeDelete} disabled={remove.isPending || purge.isPending}>Cancel</DButton>
              <DButton
                variant="danger"
                loading={deleteMode === 'hard' ? purge.isPending : remove.isPending}
                // Both sides trimmed: a society saved with a stray trailing
                // space ("Name ") could otherwise never be confirmed.
                disabled={deleteConfirmText.trim() !== (deleting.displayName ?? deleting.name).trim()}
                onClick={() =>
                  deleteMode === 'hard'
                    ? purge.mutate({ id: deleting.id, confirmName: deleteConfirmText })
                    : remove.mutate(deleting.id)
                }
              >
                <Trash2 size={13} /> {deleteMode === 'hard' ? 'Delete permanently' : 'Remove society'}
              </DButton>
            </div>
          </div>
        )}
      </DModal>
    </PlatformShell>
  );
}
