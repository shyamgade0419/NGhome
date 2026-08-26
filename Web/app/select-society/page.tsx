'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';

export default function SelectSocietyPage() {
  const { memberships, isLoading, selectSociety } = useAuth();
  const router = useRouter();
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !memberships.length) {
      router.replace('/login');
    }
  }, [isLoading, memberships.length, router]);

  const handleSelect = async (societyId: string) => {
    setSelecting(societyId);
    try {
      await selectSociety(societyId);
      router.replace('/');
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to select society';
      toast.error(msg);
    } finally {
      setSelecting(null);
    }
  };

  if (isLoading || !memberships.length) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600">
            <Building2 size={20} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-slate-900">NG Home</p>
            <p className="text-xs text-slate-500">Select your society</p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-slate-900">Select Society</h2>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Your account is linked to multiple societies. Choose one to continue.
        </p>

        <div className="space-y-3">
          {memberships.map((m) => (
            <button
              key={m.id}
              onClick={() => handleSelect(m.societyId)}
              disabled={!!selecting}
              className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-primary-400 hover:shadow-sm transition-all disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{m.societyName}</p>
                  <p className="text-sm text-slate-500">
                    {m.role.replace(/_/g, ' ')}
                    {m.flatNumber ? ` · Flat ${m.flatNumber}` : ''}
                    {m.buildingName ? ` · ${m.buildingName}` : ''}
                  </p>
                </div>
                {selecting === m.societyId ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                ) : (
                  <div className="h-2 w-2 rounded-full bg-green-400" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
