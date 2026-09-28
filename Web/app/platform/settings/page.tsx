'use client';

/**
 * Platform settings: who can sign in to this console. An admin can deactivate
 * and reactivate the others but never themselves, so at least one active
 * platform admin always remains (the API enforces this too).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, ShieldCheck, Terminal, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi, PlatformAdminUser } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PricingSupportCard } from '@/components/platform/PricingSupportCard';
import { Card, DButton, DModal, DTable, Empty, Loading, PageHeader, Pill, TableWrap, Td } from '@/components/platform/ui';
import { formatDate, formatDateTime } from '@/lib/utils';

const inputClass =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

function InviteAdminModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const reset = () => {
    setEmail('');
    setFirstName('');
    setLastName('');
  };

  const invite = useMutation({
    mutationFn: () => platformApi.inviteAdmin({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim() }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['platform-admins'] });
      toast.success(`Invite sent to ${res.data.email} — they'll get a link to set their own password.`);
      reset();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to send invite'),
  });

  const canSubmit = email.trim() !== '' && firstName.trim() !== '' && lastName.trim() !== '';

  return (
    <DModal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Invite a platform admin"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-300">
          They get an email with a link to set their own password — nobody here ever sees or chooses it.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="inv-first" className="mb-1 block text-xs font-medium text-gray-300">First name</label>
            <input id="inv-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="inv-last" className="mb-1 block text-xs font-medium text-gray-300">Last name</label>
            <input id="inv-last" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label htmlFor="inv-email" className="mb-1 block text-xs font-medium text-gray-300">Email</label>
          <input
            id="inv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@novagade.in"
            autoComplete="off"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            Use one that isn&apos;t also a society login — a platform-admin session has no society.
          </p>
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <DButton onClick={() => { reset(); onClose(); }}>Cancel</DButton>
          <DButton variant="primary" loading={invite.isPending} disabled={!canSubmit} onClick={() => invite.mutate()}>
            <Mail size={14} /> Send invite
          </DButton>
        </div>
      </div>
    </DModal>
  );
}

export default function PlatformSettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<PlatformAdminUser | null>(null);
  const [inviting, setInviting] = useState(false);

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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Admin users</h2>
            <DButton size="sm" variant="primary" onClick={() => setInviting(true)}>
              <UserPlus size={14} /> Invite admin
            </DButton>
          </div>
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

        <Card title="Adding a platform admin from the server" icon={Terminal}>
          <p className="text-sm text-gray-300">
            &quot;Invite admin&quot; above is the usual way. This command does the same thing without email — useful if
            SMTP is down, or for the very first admin before anyone can sign in to invite one. Run it in the
            API&apos;s folder:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-950 p-3 text-xs leading-relaxed text-gray-300">
{`PLATFORM_ADMIN_EMAIL=name@example.com \\
PLATFORM_ADMIN_PASSWORD='a-long-password' \\
npm run platform-admin:create:prod`}
          </pre>
        </Card>
      </div>

      <InviteAdminModal open={inviting} onClose={() => setInviting(false)} />

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
