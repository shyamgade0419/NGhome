'use client';

/**
 * Self-service account page for the signed-in platform admin: who they are,
 * a name-change form, and a change-password form. Reuses the exact BFF
 * routes the society-side profile page already uses
 * (/api/auth/update-profile, /api/auth/change-password — both read the
 * ng_access cookie directly) — neither backend endpoint has a society/role
 * check, so both already worked for a platform admin, they just had no page
 * to reach them from in this console.
 */

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Mail, Save, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Card, DButton, PageHeader } from '@/components/platform/ui';

const inputClass =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

async function patchProfile(body: { firstName: string; lastName: string }) {
  const res = await fetch('/api/auth/update-profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? 'Update failed');
  return data;
}

async function postChangePassword(body: { currentPassword: string; newPassword: string }) {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? 'Password change failed');
  return data;
}

export default function PlatformProfilePage() {
  const { user, logout, refreshUser } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Populate once the auth context resolves the user, same pattern as the
  // society-side profile page — an empty dependency on user.id so a later
  // refetch (e.g. after saving) doesn't stomp on what's being typed.
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const saveProfile = useMutation({
    mutationFn: patchProfile,
    onSuccess: async () => {
      toast.success('Profile updated');
      await refreshUser();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nameChanged = firstName.trim() !== (user?.firstName ?? '') || lastName.trim() !== (user?.lastName ?? '');
  const nameValid = firstName.trim() !== '' && lastName.trim() !== '';

  const changePassword = useMutation({
    mutationFn: postChangePassword,
    onSuccess: () => {
      toast.success('Password changed — please sign in again.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // Every session (including this one) was just revoked server-side.
      setTimeout(() => logout(), 1200);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword;
  const tooShort = newPassword !== '' && newPassword.length < 8;
  const canSubmit = currentPassword !== '' && newPassword !== '' && !mismatch && !tooShort;

  return (
    <PlatformShell>
      <PageHeader title="My profile" subtitle="Your platform-admin account" />

      <div className="max-w-xl space-y-6">
        <Card title="Account" icon={ShieldCheck}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameValid && nameChanged) saveProfile.mutate({ firstName: firstName.trim(), lastName: lastName.trim() });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="first-name" className="mb-1 block text-xs font-medium text-gray-300">First name</label>
                <input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="last-name" className="mb-1 block text-xs font-medium text-gray-300">Last name</label>
                <input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-gray-400"><Mail size={13} /> {user?.email}</span>
              <DButton type="submit" size="sm" variant="primary" loading={saveProfile.isPending} disabled={!nameValid || !nameChanged}>
                <Save size={13} /> Save name
              </DButton>
            </div>
          </form>
          <p className="mt-3 text-xs text-gray-500">
            Changing your email isn&apos;t self-service yet — ask another platform admin, or use the server script.
          </p>
        </Card>

        <Card title="Change password" icon={KeyRound}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) changePassword.mutate({ currentPassword, newPassword });
            }}
          >
            <div>
              <label htmlFor="current-pw" className="mb-1 block text-xs font-medium text-gray-300">Current password</label>
              <input
                id="current-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="new-pw" className="mb-1 block text-xs font-medium text-gray-300">New password</label>
              <input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={tooShort}
                className={inputClass}
              />
              {tooShort && <p className="mt-1 text-xs text-red-400">At least 8 characters.</p>}
            </div>
            <div>
              <label htmlFor="confirm-pw" className="mb-1 block text-xs font-medium text-gray-300">Confirm new password</label>
              <input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={mismatch}
                className={inputClass}
              />
              {mismatch && <p className="mt-1 text-xs text-red-400">Passwords don&apos;t match.</p>}
            </div>
            <p className="rounded-lg bg-gray-800/60 px-3 py-2 text-xs text-gray-400">
              This signs you — and any other device you&apos;re signed in on — out everywhere. You&apos;ll need to log
              back in with the new password.
            </p>
            <div className="flex justify-end">
              <DButton type="submit" variant="primary" loading={changePassword.isPending} disabled={!canSubmit}>
                Change password
              </DButton>
            </div>
          </form>
        </Card>
      </div>
    </PlatformShell>
  );
}
