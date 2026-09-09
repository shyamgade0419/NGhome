'use client';

/**
 * Platform-admin society directory — not part of the (dashboard) layout
 * group deliberately: that layout and its Header/Sidebar assume a society
 * context (a societyId claim on the token), which a platform-admin session
 * never has (see auth.service.ts login() — isPlatformAdmin gets a
 * society-independent token). This is a separate, standalone surface for
 * the NovaGade team, not something a society's own admin ever sees.
 *
 * Every request here hits PlatformAdminGuard-protected routes, so a
 * non-platform-admin who lands here (e.g. pasting the URL) gets nothing
 * back from the API even before the client-side check below redirects them.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Phone, Mail, Users, LogOut, ShieldCheck, Home, UserCog, Ban, RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi, PlatformSociety } from '@/lib/api/endpoints';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-slate-400">
        <Icon size={13} />
        <p className="text-[11px] font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

export default function PlatformDashboard() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<PlatformSociety | null>(null);

  useEffect(() => {
    if (!authLoading && user && !user.isPlatformAdmin) {
      router.replace('/');
    }
  }, [authLoading, user, router]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-societies'],
    queryFn: () => platformApi.listSocieties({ limit: 100 }).then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  const { data: stats } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => platformApi.stats().then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      platformApi.setSocietyStatus(id, isActive),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['platform-societies'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      toast.success(vars.isActive ? 'Society reinstated' : 'Society suspended');
      setConfirming(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update society'),
  });

  if (authLoading || (user && !user.isPlatformAdmin)) {
    return <div className="flex min-h-screen items-center justify-center"><PageSpinner /></div>;
  }

  const societies: PlatformSociety[] = data?.data ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
            <ShieldCheck size={16} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">NG Home — Platform Console</h1>
            <p className="text-xs text-slate-500">{societies.length} society{societies.length === 1 ? '' : 'ies'}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
        >
          <LogOut size={15} /> Sign out
        </button>
      </header>

      <main className="p-6">
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Societies" value={stats.societies} icon={Building2} />
            <StatCard label="Active" value={stats.activeSocieties} icon={ShieldCheck} />
            <StatCard label="Suspended" value={stats.suspendedSocieties} icon={Ban} />
            <StatCard label="Buildings" value={stats.buildings} icon={Building2} />
            <StatCard label="Flats" value={stats.flats} icon={Home} />
            <StatCard label="Members" value={stats.members} icon={Users} />
          </div>
        )}

        {isLoading ? (
          <PageSpinner />
        ) : isError ? (
          <EmptyState
            icon={Building2}
            title="Couldn't load societies"
            description="Try refreshing the page."
          />
        ) : societies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No societies yet"
            description="Societies will appear here once they register."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <Table>
              <Thead>
                <Tr>
                  <Th>Society</Th>
                  <Th>Admin Contact</Th>
                  <Th>Members</Th>
                  <Th>Buildings</Th>
                  <Th>Join Code</Th>
                  <Th>Status</Th>
                  <Th>Since</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {societies.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{s.displayName ?? s.name}</p>
                      {(s.city || s.state) && (
                        <p className="text-xs text-slate-500">{[s.city, s.state].filter(Boolean).join(', ')}</p>
                      )}
                    </Td>
                    <Td>
                      {s.admins.length === 0 ? (
                        <span className="text-xs text-slate-400">No admin found</span>
                      ) : (
                        <div className="space-y-1.5">
                          {s.admins.map((a) => (
                            <div key={a.id}>
                              <p className="text-sm text-slate-800">{a.firstName} {a.lastName}</p>
                              <div className="flex flex-col gap-0.5 text-xs text-slate-500">
                                {a.phone && (
                                  <span className="flex items-center gap-1"><Phone size={11} /> {a.phone}</span>
                                )}
                                <span className="flex items-center gap-1"><Mail size={11} /> {a.email}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1 text-slate-600">
                        <Users size={13} /> {s._count.memberships}
                      </span>
                    </Td>
                    <Td className="text-slate-600">{s._count.buildings}</Td>
                    <Td>
                      {s.joinCode ? (
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">{s.joinCode}</code>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge variant={s.isActive ? 'success' : 'danger'}>{s.isActive ? 'Active' : 'Suspended'}</Badge>
                    </Td>
                    <Td className="text-slate-500 text-xs">
                      {new Date(s.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Td>
                    <Td className="text-right">
                      {/* Confirmed rather than immediate: suspending cuts off a
                          whole society's residents, and the row a cursor lands
                          on is not always the one that was meant. */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirming(s)}
                      >
                        {s.isActive ? (
                          <><Ban size={13} /> Suspend</>
                        ) : (
                          <><RotateCcw size={13} /> Reinstate</>
                        )}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </main>

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming?.isActive ? 'Suspend society' : 'Reinstate society'}
      >
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              {confirming.isActive ? (
                <>
                  Suspend <strong>{confirming.displayName ?? confirming.name}</strong>?
                  Its {confirming._count.memberships} member
                  {confirming._count.memberships === 1 ? '' : 's'} will lose access.
                </>
              ) : (
                <>
                  Reinstate <strong>{confirming.displayName ?? confirming.name}</strong>? Its members
                  get access back immediately.
                </>
              )}
            </p>
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              Nothing is deleted either way. Memberships, bills and history are kept, so a
              suspended society comes back exactly as it was.
            </p>
            {confirming.admins.length > 0 && confirming.isActive && (
              <p className="text-xs text-slate-500">
                Worth telling first: {confirming.admins.map((a) => `${a.firstName} ${a.lastName}`).join(', ')}
                {confirming.admins[0]?.email ? ` (${confirming.admins[0].email})` : ''}.
              </p>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  setStatus.mutate({ id: confirming.id, isActive: !confirming.isActive })
                }
                loading={setStatus.isPending}
              >
                {confirming.isActive ? 'Suspend' : 'Reinstate'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
