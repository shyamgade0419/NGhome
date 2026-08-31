'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { User, KeyRound, Save } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { initials, roleLabel } from '@/lib/utils';

async function patchProfile(body: { firstName?: string; lastName?: string; phone?: string }) {
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

export default function ProfilePage() {
  const { user, activeMembership, refreshUser } = useAuth();

  // Profile form state
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const profileMutation = useMutation({
    mutationFn: () => patchProfile({ firstName, lastName, phone }),
    onSuccess: async () => {
      await refreshUser();
      toast.success('Profile updated');
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to update profile'),
  });

  const passwordMutation = useMutation({
    mutationFn: () => postChangePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('Password changed — please log in again');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to change password'),
  });

  const role = activeMembership?.role ?? user?.currentRole ?? '';
  const displayName = user?.displayName ?? '';

  const passwordValid =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  return (
    <>
      <Header title="My Profile" subtitle="Manage your account details and security" />
      <PageContainer className="max-w-2xl space-y-6">

        {/* Avatar + identity */}
        <Card className="flex items-center gap-5 p-6">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xl font-bold text-primary-700">
            {initials(displayName)}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">{displayName || '—'}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
            {role && (
              <p className="mt-0.5 text-xs font-medium text-primary-600">
                {roleLabel(role)}
              </p>
            )}
          </div>
        </Card>

        {/* Edit profile */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <User size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Personal Information</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
            />
            <Input
              label="Last Name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>

          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 9876543210"
            type="tel"
          />

          <Input
            label="Email"
            value={user?.email ?? ''}
            readOnly
            disabled
            className="opacity-60"
            hint="Email cannot be changed here"
          />

          <div className="flex justify-end">
            <Button
              onClick={() => profileMutation.mutate()}
              loading={profileMutation.isPending}
              disabled={!firstName.trim() && !lastName.trim()}
            >
              <Save size={15} className="mr-1.5" />
              Save Changes
            </Button>
          </div>
        </Card>

        {/* Change password */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Change Password</h2>
          </div>

          <Input
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
            autoComplete="current-password"
          />
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
            autoComplete="new-password"
            error={
              confirmPassword.length > 0 && newPassword !== confirmPassword
                ? 'Passwords do not match'
                : undefined
            }
          />

          <div className="flex justify-end">
            <Button
              onClick={() => passwordMutation.mutate()}
              loading={passwordMutation.isPending}
              disabled={!passwordValid}
              variant="outline"
            >
              <KeyRound size={15} className="mr-1.5" />
              Change Password
            </Button>
          </div>
        </Card>

      </PageContainer>
    </>
  );
}
