'use client';

/**
 * Platform settings: who can sign in to this console. An admin can deactivate
 * and reactivate the others but never themselves, so at least one active
 * platform admin always remains (the API enforces this too).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi, PlatformAdminUser } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PricingSupportCard } from '@/components/platform/PricingSupportCard';
import { Card, DButton, DModal, DTable, Empty, Loading, PageHeader, Pill, TableWrap, Td } from '@/components/platform/ui';
import { formatDate, formatDateTime } from '@/lib/utils';

export default function PlatformSettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<PlatformAdminUser | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-admins'],
    queryFn: () => platformApi.admins().then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => platformApi.setAdminStatus(id, isActive),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['platform-admins'] });
      toast.success(vars.isActive ? 'Admin reactivated' : 'Admin deactivated');
      setConfirming(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update admin'),
  });

  return (
    <PlatformShell>
      <PageHeader title="Settings" subtitle="Platform administration" />

      <div className="space-y-6">
        <PricingSupportCard />

        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">Admin users</h2>
          {isLoading ? (
            <Loading />
          ) : isError || !data ? (
            <Empty icon={ShieldCheck} title="Couldn't load admins" description="Try refreshing the page." />
          ) : (
            <TableWrap>
              <DTable head={['Name / email', 'Last login', 'Added', 'Status', <span key="a" className="block text-right">Actions</span>]}>
                {data.map((a) => {
                  const isYou = a.id === user?.id;
                  return (
                    <tr key={a.id} className="hover:bg-gray-800/30">
                      <Td>
                        <p className="flex items-center gap-2 font-medium text-white">
                          {a.firstName} {a.lastName}
                          {isYou && <Pill tone="blue">You</Pill>}
                        </p>
                        <p className="text-xs text-gray-400">{a.email}</p>
                      </Td>
                      <Td className="text-xs text-gray-400">{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'Never'}</Td>
                      <Td className="text-xs text-gray-400">{formatDate(a.createdAt)}</Td>
                      <Td>
                        <Pill tone={a.isActive ? 'green' : 'red'}>{a.isActive ? 'Active' : 'Inactive'}</Pill>
                      </Td>
                      <Td className="text-right">
                        {isYou ? (
                          <span className="text-xs text-gray-500">—</span>
                        ) : (
                          <DButton size="sm" onClick={() => setConfirming(a)}>
                            {a.isActive ? 'Deactivate' : 'Activate'}
                          </DButton>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </DTable>
            </TableWrap>
          )}
        </section>

        <Card title="Adding a platform admin" icon={Terminal}>
          <p className="text-sm text-gray-300">
            New platform admins are created on the server, so a password is never typed into a web form. Run this in the
            API&apos;s folder:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-950 p-3 text-xs leading-relaxed text-gray-300">
{`PLATFORM_ADMIN_EMAIL=name@example.com \\
PLATFORM_ADMIN_PASSWORD='a-long-password' \\
npm run platform-admin:create:prod`}
          </pre>
          <p className="mt-3 text-xs text-gray-500">
            Use an email that isn&apos;t also a society login: a platform-admin session has no society, so that account
            couldn&apos;t open its society any more.
          </p>
        </Card>
      </div>

      <DModal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming?.isActive ? 'Deactivate admin' : 'Activate admin'}
      >
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              {confirming.isActive ? (
                <>
                  <strong className="text-white">{confirming.firstName} {confirming.lastName}</strong> will no longer be
                  able to sign in to the platform console. Their account is kept.
                </>
              ) : (
                <>
                  <strong className="text-white">{confirming.firstName} {confirming.lastName}</strong> will be able to sign
                  in to the platform console again.
                </>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <DButton onClick={() => setConfirming(null)}>Cancel</DButton>
              <DButton
                variant={confirming.isActive ? 'danger' : 'primary'}
                loading={toggle.isPending}
                onClick={() => toggle.mutate({ id: confirming.id, isActive: !confirming.isActive })}
              >
                {confirming.isActive ? 'Deactivate' : 'Activate'}
              </DButton>
            </div>
          </div>
        )}
      </DModal>
    </PlatformShell>
  );
}
