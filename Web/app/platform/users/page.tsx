'use client';

/**
 * Platform-wide user directory: every account across every society, with the
 * societies and roles each one holds. Read-only — suspending or editing a
 * person stays with their society's own admin.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Mail, Phone, Search, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { DButton, DTable, Empty, Loading, PageHeader, Pill, TableWrap, Td } from '@/components/platform/ui';
import { formatDate, formatDateTime, roleLabel } from '@/lib/utils';

const PAGE_SIZE = 25;

export default function PlatformUsersPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');

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
    queryKey: ['platform-users', page, search],
    queryFn: () => platformApi.listUsers({ page, limit: PAGE_SIZE, search: search || undefined }).then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
    placeholderData: keepPreviousData,
  });

  const users = data?.data ?? [];
  const meta = data?.meta;

  return (
    <PlatformShell>
      <PageHeader
        title="Users"
        subtitle={meta ? `${meta.total} user${meta.total === 1 ? '' : 's'} across all societies` : 'Every account on the platform'}
      />

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
          title={search ? 'No matching users' : 'No users yet'}
          description={search ? 'Try a different name, email or phone number.' : 'Users appear here once they register.'}
        />
      ) : (
        <>
          <TableWrap>
            <DTable head={['User', 'Contact', 'Societies & roles', 'Last login', 'Joined', 'Status']}>
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
    </PlatformShell>
  );
}
