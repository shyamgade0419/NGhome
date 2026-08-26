'use client';

import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { initials, roleLabel } from '@/lib/utils';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <>
      <Header title="Settings" subtitle="Account & society configuration" />
      <PageContainer className="space-y-6">
        {/* Profile */}
        <Card padding="lg">
          <CardHeader>
            <CardTitle>My Account</CardTitle>
          </CardHeader>
          <div className="flex items-center gap-5">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xl font-bold text-primary-700">
              {user ? initials(user.displayName) : '?'}
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">{user?.displayName}</p>
              <p className="text-sm text-slate-500">{user?.email}</p>
              {user?.phone && <p className="text-sm text-slate-500">{user.phone}</p>}
              <span className="mt-1 inline-block rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                {roleLabel(user?.currentRole ?? '')}
              </span>
            </div>
          </div>
        </Card>

        {/* Upcoming settings sections */}
        {[
          { title: 'Society Settings', desc: 'Billing cycle, currency, payment methods, and general society configuration.' },
          { title: 'Residents & Flats', desc: 'Manage resident registrations, flat assignments, and building structure.' },
          { title: 'Roles & Permissions', desc: 'Configure committee access levels and administrative roles.' },
          { title: 'Notification Preferences', desc: 'Email and in-app notification settings for billing, payments, and community alerts.' },
          { title: 'Billing Rules', desc: 'Create and manage maintenance charge calculation rules.' },
        ].map(({ title, desc }) => (
          <Card key={title} padding="lg" className="opacity-60">
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">Coming Soon</span>
            </CardHeader>
            <p className="text-sm text-slate-500">{desc}</p>
          </Card>
        ))}
      </PageContainer>
    </>
  );
}
