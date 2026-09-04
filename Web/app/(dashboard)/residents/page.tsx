'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Phone, MessageSquare, Pencil, AlertCircle, X, Hourglass, Check } from 'lucide-react';
import { societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { initials, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Resident {
  id: string;          // membershipId
  userId: string;
  firstName: string;
  lastName: string;
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

/* ── Edit resident modal ─────────────────────────────────────── */
function EditResidentModal({
  resident,
  onClose,
}: {
  resident: Resident;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState(resident.firstName);
  const [lastName, setLastName] = useState(resident.lastName);
  const [phone, setPhone] = useState(resident.phone ?? '');

  const updateMutation = useMutation({
    mutationFn: () =>
      societyApi.updateUser(resident.userId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Resident info updated');
      qc.invalidateQueries({ queryKey: ['residents'] });
      onClose();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to update resident'),
  });

  const handleSave = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('Name is required');
      return;
    }
    updateMutation.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Edit Resident</h3>
            <p className="text-xs text-slate-500 mt-0.5">{resident.flatNumber} · {resident.email}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First Name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Ravi"
            />
            <Input
              label="Last Name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Kumar"
            />
          </div>

          <div>
            <Input
              label="Phone (WhatsApp)"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 9876543210"
            />
            <p className="mt-1 text-xs text-slate-400">
              Used for WhatsApp billing reminders. Include country code.
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            ⚠️ Email address cannot be changed here. Contact platform support for email changes.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={updateMutation.isPending} onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Pending join approvals ──────────────────────────────────── */
// A flat already had an active resident when this person joined via invite
// code, so AuthService.joinSociety() parked them PENDING instead of
// granting instant access. Approve (spouse/tenant/co-owner — legitimate)
// or reject (stranger who guessed/shared the join code).
function PendingApprovals() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => societyApi.pendingApprovals().then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (membershipId: string) => societyApi.approvePending(membershipId),
    onSuccess: () => {
      toast.success('Approved — the resident can now sign in');
      qc.invalidateQueries({ queryKey: ['pending-approvals'] });
      qc.invalidateQueries({ queryKey: ['residents'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to approve'),
  });

  const reject = useMutation({
    mutationFn: (membershipId: string) => societyApi.rejectPending(membershipId),
    onSuccess: () => {
      toast.success('Join request rejected');
      qc.invalidateQueries({ queryKey: ['pending-approvals'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to reject'),
  });

  const pending = data ?? [];
  if (isLoading || pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
        <Hourglass size={16} />
        {pending.length} join request{pending.length !== 1 ? 's' : ''} awaiting approval
      </div>
      <div className="mt-2 divide-y divide-amber-100">
        {pending.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {p.user.firstName} {p.user.lastName} <span className="text-slate-400 font-normal">· {p.user.email}</span>
              </p>
              <p className="text-xs text-amber-700">
                Wants to join {p.flat?.flatCode ?? 'a flat'} — already has an active resident
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="text-green-700 hover:bg-green-50"
                loading={approve.isPending && approve.variables === p.id}
                onClick={() => {
                  if (confirm(`Give ${p.user.firstName} ${p.user.lastName} resident access to ${p.flat?.flatCode ?? 'this flat'}?`)) {
                    approve.mutate(p.id);
                  }
                }}
              >
                <Check size={13} className="mr-1" /> Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50"
                loading={reject.isPending && reject.variables === p.id}
                onClick={() => {
                  if (confirm(`Reject ${p.user.firstName} ${p.user.lastName}'s request to join ${p.flat?.flatCode ?? 'this flat'}?`)) {
                    reject.mutate(p.id);
                  }
                }}
              >
                <X size={13} className="mr-1" /> Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────── */
export default function ResidentsPage() {
  const qc = useQueryClient();
  const [page] = useState(1);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);

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

  const residents: Resident[] = (data?.data ?? []).map((u: any) => {
    const membership = u.memberships?.[0];
    return {
      id: membership?.id ?? u.id,
      userId: u.id,
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      email: u.email,
      phone: u.phone ?? null,
      flatNumber: membership?.flat?.flatCode ?? '',
      buildingName: membership?.flat?.building?.name ?? '',
      role: membership?.role ?? '',
      status: membership?.status ?? (u.isActive ? 'ACTIVE' : 'INACTIVE'),
    };
  });

  const missingPhone = residents.filter((r) => !r.phone && r.role === 'RESIDENT').length;

  return (
    <>
      <Header
        title="Residents"
        subtitle={residents.length > 0 ? `${residents.length} member${residents.length !== 1 ? 's' : ''}` : undefined}
      />
      <PageContainer className="space-y-4">
        <PendingApprovals />

        {/* Missing phone notice */}
        {missingPhone > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              <strong>{missingPhone} resident{missingPhone !== 1 ? 's' : ''}</strong> have no phone number saved —
              they won&apos;t receive WhatsApp billing reminders. Click <strong>Edit</strong> to add their number.
            </span>
          </div>
        )}

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
                  <Th>Phone (WhatsApp)</Th>
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
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        ROLE_COLOR[r.role] ?? 'bg-slate-50 text-slate-600',
                      )}>
                        {roleLabel(r.role)}
                      </span>
                    </Td>

                    {/* Phone */}
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
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <Phone size={10} /> No phone
                          </span>
                        )}
                      </div>
                    </Td>

                    {/* Status */}
                    <Td>
                      <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>
                        {r.status}
                      </Badge>
                    </Td>

                    {/* Actions */}
                    <Td>
                      <div className="flex items-center gap-1">
                        {/* Edit button — always visible */}
                        <button
                          onClick={() => setEditingResident(r)}
                          title="Edit resident info"
                          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          <Pencil size={13} />
                          Edit
                        </button>

                        {/* Remove — not for admins */}
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
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}

        {/* Edit modal */}
        {editingResident && (
          <EditResidentModal
            resident={editingResident}
            onClose={() => setEditingResident(null)}
          />
        )}
      </PageContainer>
    </>
  );
}
