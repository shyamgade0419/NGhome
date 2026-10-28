'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { societyApi } from '@/lib/api/endpoints';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

export interface MemberToDelete {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
}

/**
 * Permanently deletes a member's account. "Remove" only ends the membership and
 * leaves the account — so the person's email and phone stay taken and they can
 * never be added again. This erases the account itself.
 *
 * The server says first what would go and what stops it (money and notice
 * records the society keeps, someone who also belongs to another society, the
 * society's only admin), and checks the typed email again before it deletes.
 */
export function DeleteMemberModal({ member, onClose }: { member: MemberToDelete | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');

  const previewQ = useQuery({
    queryKey: ['member-deletion-preview', member?.userId],
    queryFn: () => societyApi.memberDeletionPreview(member!.userId).then((r) => r.data),
    enabled: !!member,
    staleTime: 0,
    gcTime: 0,
  });
  const preview = previewQ.data;

  const erase = useMutation({
    mutationFn: () => societyApi.deleteMember(member!.userId, typed),
    onSuccess: () => {
      toast.success(`${member!.name} was deleted. Their email and phone can be used again.`);
      qc.invalidateQueries({ queryKey: ['residents'] });
      qc.invalidateQueries({ queryKey: ['removed-members'] });
      close();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not delete the account — nothing was deleted'),
  });

  function close() {
    setTyped('');
    onClose();
  }

  const matches = !!preview && typed.trim().toLowerCase() === preview.user.email.toLowerCase();

  return (
    <Modal open={!!member} onClose={() => !erase.isPending && close()} title="Delete account permanently" size="sm">
      {member && (
        <div className="space-y-4">
          <div>
            <p className="font-medium text-slate-900">{member.name}</p>
            <p className="text-xs text-slate-500">
              {member.email}
              {member.phone ? ` · ${member.phone}` : ''}
            </p>
          </div>

          {previewQ.isLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : previewQ.isError || !preview ? (
            <p className="text-sm text-red-600">Couldn&apos;t check this account. Close this and try again.</p>
          ) : (
            <>
              {preview.reasons.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {preview.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}

              {preview.blockedBy.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">The society still has records from this person:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {preview.blockedBy.map((b) => <li key={b.label}>{b.label}: {b.count}</li>)}
                  </ul>
                  <p className="mt-2 text-xs text-amber-800">
                    Those are part of the society&apos;s history (payments, notices and so on), so the account is kept.
                    Use Remove instead, which ends their access but keeps those records.
                  </p>
                </div>
              )}

              {preview.canDelete && (
                <>
                  <p className="text-sm text-slate-700">
                    This erases the account for good. They can no longer sign in, and their email and phone can be used
                    for a new sign-up.
                    {preview.willRemove.length > 0 && ' It also removes:'}
                  </p>
                  {preview.willRemove.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-slate-600">
                      {preview.willRemove.map((w) => <li key={w.label}>{w.label}: {w.count}</li>)}
                    </ul>
                  )}
                  <div>
                    <label htmlFor="confirm-member-email" className="mb-1 block text-xs font-medium text-slate-700">
                      Type <span className="font-mono text-slate-900">{preview.user.email}</span> to confirm
                    </label>
                    <input
                      id="confirm-member-email"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      autoComplete="off"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                    />
                  </div>
                </>
              )}
            </>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" onClick={close} disabled={erase.isPending}>
              {preview && !preview.canDelete ? 'Close' : 'Cancel'}
            </Button>
            {preview?.canDelete && (
              <Button variant="danger" loading={erase.isPending} disabled={!matches} onClick={() => erase.mutate()}>
                <Trash2 size={14} className="mr-1.5" /> Delete permanently
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
