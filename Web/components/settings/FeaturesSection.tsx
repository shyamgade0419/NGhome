'use client';

/**
 * Settings → Features. Switch off the parts of the app this society does not use (no parking, no gate, no clubhouse), and
 * they disappear from everyone's app and from this website. Nothing is deleted: switch one back on and it returns with its data.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { societyApi } from '@/lib/api/endpoints';
import { useFeatures } from '@/lib/useFeatures';
import { FEATURES, FeatureKey, Features } from '@/lib/features';
import { tint, tones } from '@/lib/tones';

export function FeaturesSection({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const { features } = useFeatures();

  const save = useMutation({
    mutationFn: (patch: Partial<Features>) => societyApi.setFeatures(patch),
    // Shown at once; put back if the server refuses.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['society-features'] });
      const before = qc.getQueryData<Features>(['society-features']);
      qc.setQueryData<Features>(['society-features'], { ...features, ...patch });
      return { before };
    },
    onError: (e: any, _patch, ctx) => {
      qc.setQueryData(['society-features'], ctx?.before);
      toast.error(e?.response?.data?.message ?? 'Could not change that. Try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['society-features'] }),
  });

  const off = FEATURES.filter((f) => !features[f.key]).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Switch off what your society does not use, such as parking or a clubhouse. It disappears from everyone&apos;s app and from this
        website. Nothing is deleted: switch it back on and it returns with its data.{' '}
        <span className="font-medium text-slate-700">{off === 0 ? 'Everything is switched on.' : `${off} switched off.`}</span>
      </p>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          const color = tones[f.tone];
          const on = features[f.key];
          return (
            <li key={f.key} className="flex items-center gap-3 px-3 py-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: tint(color, 0.84), color }} aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{f.label}</span>
                <span className="block text-xs text-slate-500">{f.description}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={f.label}
                disabled={!admin}
                onClick={() => save.mutate({ [f.key]: !on } as Partial<Record<FeatureKey, boolean>>)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${on ? 'bg-primary-600' : 'bg-slate-200'} ${!admin ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${on ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </li>
          );
        })}
      </ul>
      {!admin && <p className="text-xs text-slate-400">Only the society admin can change these.</p>}
    </div>
  );
}
