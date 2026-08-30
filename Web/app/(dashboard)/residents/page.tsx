'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Phone, MessageSquare } from 'lucide-react';
import { societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { initials } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Resident {
  id: string;          // membershipId
  userId: string;
  displayName: string;
  email: string;
  phone: string | null;
  flatNumber: string;
  buildingName: string;
  role: string;
  status: string;
}

const ROLE_COLOR: Record<string, string> = {
  SOCIETY_ADMIN:       'bg-red-50   text-red-700',
  SOCIETY_ACCOUNTANT:  'bg-amber-50 text-amber-700',
  SOCIETY_STAFF:       'bg-blue-50  text-blue-700',
  RESIDENT:            'bg-green-50 text-green-700',
};

function roleLabel(role: string) {
  return role.replace('SOCIETY_', '').replace(/_/g, ' ');
}

export default function ResidentsPage() {
  const qc = useQueryClient();
  const [page] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['residents', page],
    queryFn: () =>
      societyApi.residents({ page, limit: 100 }).then((r: any) => r.data),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      (societyApi as any).removeMember(userId),
    onSuccess: () => {
      toast.success('Member removed from society');
      qc.invalidateQueries({ queryKey: ['residents'] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to remove member'),
  });

  const handleRemove = (r: Resident) => {
    if (!confirm(`Remove ${r.displayName} (${r.flatNumber}) from the society? They will lose access immediately.`)) return;
    removeMutation.mutate(r.userId);
  };

  const handleWhatsApp = (phone: string, name: string) => {
    const msg = `Hi ${name}, this is a message from your society management.`;
    const digits = phone.replace(/\D/g, '');
    const e164 = digits.length === 10 ? `91${digits}` : digits;
    window.open(`https://wa.me/${e164}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  };

  // API returns { data: User[], meta } where User has firstName/lastName and nested memberships.
  // Map to the Resident shape the table expects.
  const residents: Resident[] = (data?.data ?? []).map((u: any) => {
    const membership = u.memberships?.[0];
    return {
      id: membership?.id ?? u.id,
      userId: u.id,
      displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      email: u.email,
      phone: u.phone ?? null,
      flatNumber: membership?.flat?.flatCode ?? '',
      buildingName: membership?.flat?.building?.name ?? '',
      role: membership?.role ?? '',
      status: membership?.status ?? (u.isActive ? 'ACTIVE' : 'INACTIVE'),
    };
  });

  return (
    <>
      <Header
        title="Residents"
        subtitle={residents.length > 0 ? `${residents.length} member${residents.length !== 1 ? 's' : ''}` : undefined}
      />
      <PageContainer>
        {isLoading ? (
          <PageSpinner />
        ) : residents.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No residents yet"
            description="Residents appear here once they join via invite code or are added by an admin."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Flat</Th>
                  <Th>Role</Th>
                  <Th>Contact</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {residents.map((r) => (
                  <Tr key={r.id}>
                    {/* Name */}
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-700">
                          {initials(r.displayName)}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{r.displayName}</p>
                          <p className="text-xs text-slate-400">{r.email}</p>
                        </div>
                      </div>
                    </Td>

                    {/* Flat */}
                    <Td>
                      <div>
                        <p className="font-medium text-slate-900">{r.flatNumber || '—'}</p>
                        {r.buildingName && (
                          <p className="text-xs text-slate-400">{r.buildingName}</p>
                        )}
                      </div>
                    </Td>

                    {/* Role */}
                    <Td>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[r.role] ?? 'bg-slate-50 text-slate-600'}`}>
                        {roleLabel(r.role)}
                      </span>
                    </Td>

                    {/* Contact */}
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {r.phone ? (
                          <>
                            <span className="text-sm text-slate-600 font-mono">{r.phone}</span>
                            <button
                              onClick={() => handleWhatsApp(r.phone!, r.displayName)}
                              title="Open WhatsApp"
                              className="flex items-center justify-center rounded-md p-1 text-green-600 hover:bg-green-50 transition-colors"
                            >
                              <MessageSquare size={14} />
                            </button>
                          </>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </div>
                    </Td>

                    {/* Status */}
                    <Td>
                      <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>
                        {r.status}
                      </Badge>
                    </Td>

                    {/* Actions — don't allow removing admins */}
                    <Td>
                      {r.role !== 'SOCIETY_ADMIN' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50"
                          onClick={() => handleRemove(r)}
                        >
                          Remove
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </PageContainer>
    </>
  );
}
