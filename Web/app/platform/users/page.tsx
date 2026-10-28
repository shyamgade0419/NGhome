'use client';

/**
 * Platform-wide user directory: every account across every society, with the
 * societies and roles each one holds. Suspending or editing a person stays
 * with their society's own admin; the one thing done here is erasing an account
 * for good — which is also how a removed resident's email and phone are freed,
 * since "remove from society" only ends the membership. Those accounts have no
 * live society, so they sit under their own tab.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Mail, Phone, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi, type PlatformUser } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { DButton, DModal, DTable, Empty, Loading, PageHeader, Pill, TableWrap, Td } from '@/components/platform/ui';
import { formatDate, formatDateTime, roleLabel } from '@/lib/utils';

const PAGE_SIZE = 25;

export default function PlatformUsersPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'live' | 'orphans'>('live');
  const [deleting, setDeleting] = useState<PlatformUser | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const qc = useQueryClient();

  // Wait for a pause in typing so each keystroke isn't its own request, and
  // go back to page 1 — the old page number may not exist in the new results.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(input.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-users', page, search, tab],
    queryFn: () =>
      platformApi
        .listUsers({ page, limit: PAGE_SIZE, search: search || undefined, withoutSociety: tab === 'orphans' || undefined })
        .then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
    placeholderData: keepPreviousData,
  });

  const users = data?.data ?? [];
  const meta = data?.meta;

  // What the delete would do, fetched when the dialog opens so the admin sees
  // the consequences (and anything that blocks it) before typing a thing.
  const previewQ = useQuery({
    queryKey: ['platform-user-deletion', deleting?.id],
    queryFn: () => platformApi.userDeletionPreview(deleting!.id).then((r) => r.data),
    enabled: !!deleting,
    staleTime: 0,
    gcTime: 0,
  });
  const preview = previewQ.data;

  function closeDelete() {
    setDeleting(null);
    setConfirmText('');
  }

  const erase = useMutation({
    mutationFn: ({ id, confirmEmail }: { id: string; confirmEmail: string }) => platformApi.deleteUser(id, confirmEmail),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      toast.success(`${res.data.name} was deleted. Their email and phone can be used again.`);
      closeDelete();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not delete the account — nothing was deleted'),
  });

  const emailMatches = !!preview && confirmText.trim().toLowerCase() === preview.user.email.toLowerCase();

  return (
    <PlatformShell>
      <PageHeader
        title="Users"
        subtitle={meta ? `${meta.total} user${meta.total === 1 ? '' : 's'} across all societies` : 'Every account on the platform'}
      />

      <div role="tablist" aria-label="Which users" className="mb-4 flex gap-1 border-b border-gray-800">
        {(
          [
            ['live', 'Everyone'],
            ['orphans', 'No active society'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === key ? 'border-teal-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'orphans' && (
        <p className="mb-4 max-w-2xl text-xs text-gray-400">
          People who were removed from their society, or whose society was deleted. They cannot use any society, but their
          email and phone stay taken until the account is deleted here.
        </p>
      )}

      <div className="relative mb-4 w-full max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search name, email or phone"
          aria-label="Search users"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <Empty icon={Users} title="Couldn't load users" description="Try refreshing the page." />
      ) : users.length === 0 ? (
        <Empty
          icon={Users}
          title={search ? 'No matching users' : tab === 'orphans' ? 'No leftover accounts' : 'No users yet'}
          description={
            search
              ? 'Try a different name, email or phone number.'
              : tab === 'orphans'
                ? 'Everyone with an account belongs to a live society.'
                : 'Users appear here once they register.'
          }
        />
      ) : (
        <>
          <TableWrap>
            <DTable head={['User', 'Contact', 'Societies & roles', 'Last login', 'Joined', 'Status', '']}>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-800/30">
                  <Td>
                    <p className="flex items-center gap-1.5 font-medium text-white">
                      {u.firstName} {u.lastName}
                      {u.isPlatformAdmin && (
                        <span title="Platform admin" className="text-teal-400">
                          <ShieldCheck size={14} />
                        </span>
                      )}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-0.5 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Mail size={11} /> {u.email}</span>
                      {u.phone && <span className="flex items-center gap-1"><Phone size={11} /> {u.phone}</span>}
                    </div>
                  </Td>
                  <Td>
                    {u.memberships.length === 0 ? (
                      <span className="text-xs text-gray-500">{u.isPlatformAdmin ? 'Platform-level' : 'No society'}</span>
                    ) : (
                      <div className="space-y-1">
                        {u.memberships.map((m, i) => (
                          <div key={`${m.society.id}-${i}`} className="flex flex-wrap items-center gap-1.5 text-sm">
                            <Link href={`/platform/${m.society.id}`} className="text-gray-100 hover:text-teal-300 hover:underline">
                              {m.society.displayName ?? m.society.name}
                            </Link>
                            <Pill tone={m.role === 'SOCIETY_ADMIN' ? 'blue' : 'slate'}>{roleLabel(m.role)}</Pill>
                            {m.flat && <span className="text-xs text-gray-500">{m.flat.flatCode}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td className="text-xs text-gray-400">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</Td>
                  <Td className="text-xs text-gray-400">{formatDate(u.createdAt)}</Td>
                  <Td>
                    <Pill tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Deactivated'}</Pill>
                  </Td>
                  <Td>
                    {u.id !== user?.id && (
                      <DButton size="sm" variant="danger" onClick={() => setDeleting(u)} aria-label={`Delete ${u.firstName} ${u.lastName}`}>
                        <Trash2 size={13} /> Delete
                      </DButton>
                    )}
                  </Td>
                </tr>
              ))}
            </DTable>
          </TableWrap>

          {meta && meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
              <span>Page {meta.page} of {meta.totalPages}</span>
              <div className="flex gap-2">
                <DButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</DButton>
                <DButton size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</DButton>
              </div>
            </div>
          )}
        </>
      )}

      <DModal open={!!deleting} onClose={() => !erase.isPending && closeDelete()} title="Delete account permanently">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              <strong className="text-white">{deleting.firstName} {deleting.lastName}</strong>
              <span className="block text-xs text-gray-400">{deleting.email}{deleting.phone ? ` · ${deleting.phone}` : ''}</span>
            </p>

            {previewQ.isLoading ? (
              <Loading />
            ) : previewQ.isError || !preview ? (
              <p className="text-sm text-red-300">Couldn&apos;t check this account. Close this and try again.</p>
            ) : (
              <>
                {preview.memberships.length > 0 && (
                  <p className="text-xs text-gray-400">
                    {preview.memberships
                      .map((m) => `${m.society} (${roleLabel(m.role)}${m.status === 'ACTIVE' ? '' : ', removed'})`)
                      .join(' · ')}
                  </p>
                )}

                {preview.reasons.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
                    {preview.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}

                {preview.blockedBy.length > 0 && (
                  <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-100">
                    <p className="font-medium">The society still has records from this person:</p>
                    <ul className="mt-1 list-disc pl-5 text-amber-200/90">
                      {preview.blockedBy.map((b) => <li key={b.label}>{b.label}: {b.count}</li>)}
                    </ul>
                    <p className="mt-2 text-xs text-amber-200/80">
                      Those are part of the society&apos;s history, so the account is kept. Deactivate the person instead, or delete the whole society.
                    </p>
                  </div>
                )}

                {preview.canDelete && (
                  <>
                    <p className="text-sm text-gray-300">
                      This erases the account for good and frees the email and phone for a new sign-up.
                      {preview.willRemove.length > 0 && ' It also removes:'}
                    </p>
                    {preview.willRemove.length > 0 && (
                      <ul className="list-disc pl-5 text-sm text-gray-400">
                        {preview.willRemove.map((w) => <li key={w.label}>{w.label}: {w.count}</li>)}
                      </ul>
                    )}
                    <div>
                      <label htmlFor="confirm-email" className="mb-1 block text-xs font-medium text-gray-300">
                        Type <span className="font-mono text-gray-200">{preview.user.email}</span> to confirm
                      </label>
                      <input
                        id="confirm-email"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        autoComplete="off"
                        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                      />
                    </div>
                  </>
                )}
              </>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <DButton onClick={closeDelete} disabled={erase.isPending}>{preview && !preview.canDelete ? 'Close' : 'Cancel'}</DButton>
              {preview?.canDelete && (
                <DButton
                  variant="danger"
                  loading={erase.isPending}
                  disabled={!emailMatches}
                  onClick={() => erase.mutate({ id: deleting.id, confirmEmail: confirmText })}
                >
                  <Trash2 size={13} /> Delete permanently
                </DButton>
              )}
            </div>
          </div>
        )}
      </DModal>
    </PlatformShell>
  );
}
