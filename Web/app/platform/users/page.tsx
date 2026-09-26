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
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { PlatformShell } from '@/components/platform/PlatformShell';
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
    queryFn: () =>
      platformApi.listUsers({ page, limit: PAGE_SIZE, search: search || undefined }).then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
    placeholderData: keepPreviousData,
  });

  const users = data?.data ?? [];
  const meta = data?.meta;

  return (
    <PlatformShell subtitle={meta ? `${meta.total} user${meta.total === 1 ? '' : 's'}` : undefined}>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search name, email or phone"
            aria-label="Search users"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : isError ? (
        <EmptyState icon={Users} title="Couldn't load users" description="Try refreshing the page." />
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? 'No matching users' : 'No users yet'}
          description={search ? 'Try a different name, email or phone number.' : 'Users appear here once they register.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <Table>
              <Thead>
                <Tr>
                  <Th>User</Th>
                  <Th>Contact</Th>
                  <Th>Societies &amp; roles</Th>
                  <Th>Last login</Th>
                  <Th>Joined</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {users.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <p className="flex items-center gap-1.5 font-medium text-slate-900">
                        {u.firstName} {u.lastName}
                        {u.isPlatformAdmin && (
                          <span title="Platform admin" className="text-primary-600">
                            <ShieldCheck size={14} />
                          </span>
                        )}
                      </p>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-0.5 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Mail size={11} /> {u.email}</span>
                        {u.phone && <span className="flex items-center gap-1"><Phone size={11} /> {u.phone}</span>}
                      </div>
                    </Td>
                    <Td>
                      {u.memberships.length === 0 ? (
                        <span className="text-xs text-slate-400">{u.isPlatformAdmin ? 'Platform-level' : 'No society'}</span>
                      ) : (
                        <div className="space-y-1">
                          {u.memberships.map((m, i) => (
                            <div key={`${m.society.id}-${i}`} className="flex flex-wrap items-center gap-1.5 text-sm">
                              <Link
                                href={`/platform/${m.society.id}`}
                                className="text-slate-800 hover:text-primary-700 hover:underline"
                              >
                                {m.society.displayName ?? m.society.name}
                              </Link>
                              <Badge variant={m.role === 'SOCIETY_ADMIN' ? 'info' : 'muted'}>{roleLabel(m.role)}</Badge>
                              {m.flat && <span className="text-xs text-slate-500">{m.flat.flatCode}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}
                    </Td>
                    <Td className="text-xs text-slate-500">{formatDate(u.createdAt)}</Td>
                    <Td>
                      <Badge variant={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>Page {meta.page} of {meta.totalPages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PlatformShell>
  );
}
