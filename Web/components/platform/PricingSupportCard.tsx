'use client';

/**
 * Pricing mode (free / paid) and the optional "buy me a coffee" note shown to
 * users. Saving is a single PUT; the API re-validates everything, including
 * that the note can't be switched on without a UPI ID.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coffee } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi, PlatformSettingsInput } from '@/lib/api/endpoints';
import { Card, DButton, Loading } from './ui';

/** Same rule the API enforces — name@handle — so the mistake is caught before the request. */
const UPI_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

const inputClass =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

const MODES = [
  ['FREE', 'Free for everyone', 'No plans or charges. This is how NG Home runs today.'],
  ['PAID', 'Paid', 'Saved for later. Nothing is charged or limited yet, because billing is not built.'],
] as const;

export function PricingSupportCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<PlatformSettingsInput | null>(null);

  const { data } = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => platformApi.settings().then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  useEffect(() => {
    if (data && !form) {
      setForm({
        pricingMode: data.pricingMode,
        supportEnabled: data.supportEnabled,
        supportUpiId: data.supportUpiId ?? '',
        supportPayeeName: data.supportPayeeName ?? '',
        supportMessage: data.supportMessage ?? '',
      });
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: (body: PlatformSettingsInput) => platformApi.updateSettings(body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-settings'] });
      toast.success('Settings saved');
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m.join(', ') : (m ?? 'Failed to save settings'));
    },
  });

  if (!form) return <Loading />;

  const upi = (form.supportUpiId ?? '').trim();
  const upiInvalid = upi !== '' && !UPI_PATTERN.test(upi);
  const needsUpi = form.supportEnabled && upi === '';
  const canSave = !upiInvalid && !needsUpi;
  const set = (patch: Partial<PlatformSettingsInput>) => setForm({ ...form, ...patch });

  return (
    <Card title="Pricing & support" icon={Coffee}>
      <div className="space-y-6">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-white">Pricing mode</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODES.map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                  form.pricingMode === value ? 'border-teal-500/50 bg-teal-500/10' : 'border-gray-700 hover:bg-gray-800/60'
                }`}
              >
                <input
                  type="radio"
                  name="pricingMode"
                  checked={form.pricingMode === value}
                  onChange={() => set({ pricingMode: value })}
                  className="mt-1 accent-teal-500"
                />
                <span>
                  <span className="block text-sm font-medium text-white">{label}</span>
                  <span className="block text-xs text-gray-400">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={form.supportEnabled}
              onChange={(e) => set({ supportEnabled: e.target.checked })}
              className="mt-1 h-4 w-4 accent-teal-500"
            />
            <span>
              <span className="block text-sm font-medium text-white">Show the &quot;buy me a coffee&quot; note</span>
              <span className="block text-xs text-gray-400">
                An optional, dismissible banner for everyone in the web app, and a small link in the mobile app. Never
                blocks anything; no amount is set.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="upi" className="mb-1 block text-xs font-medium text-gray-300">UPI ID</label>
              <input
                id="upi"
                value={form.supportUpiId ?? ''}
                onChange={(e) => set({ supportUpiId: e.target.value })}
                placeholder="yourname@bank"
                autoComplete="off"
                aria-invalid={upiInvalid || needsUpi}
                className={inputClass}
              />
              {upiInvalid && <p className="mt-1 text-xs text-red-400">Enter a UPI ID like name@bank.</p>}
              {needsUpi && <p className="mt-1 text-xs text-amber-400">Add your UPI ID to turn the note on.</p>}
            </div>
            <div>
              <label htmlFor="payee" className="mb-1 block text-xs font-medium text-gray-300">Name shown in the UPI app</label>
              <input
                id="payee"
                value={form.supportPayeeName ?? ''}
                onChange={(e) => set({ supportPayeeName: e.target.value })}
                placeholder="NG Home"
                maxLength={50}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="msg" className="mb-1 block text-xs font-medium text-gray-300">Message</label>
            <input
              id="msg"
              value={form.supportMessage ?? ''}
              onChange={(e) => set({ supportMessage: e.target.value })}
              placeholder="If NG Home helps you, you can buy me a coffee — it's completely optional."
              maxLength={140}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500">Leave blank for the default. {(form.supportMessage ?? '').length}/140</p>
          </div>

          <p className="rounded-lg bg-gray-800/60 px-3 py-2 text-xs text-gray-400">
            Your UPI ID is visible to everyone who sees the note, so use one you are comfortable sharing.
          </p>
        </div>

        <div className="flex justify-end">
          <DButton variant="primary" loading={save.isPending} disabled={!canSave} onClick={() => save.mutate(form)}>
            Save settings
          </DButton>
        </div>
      </div>
    </Card>
  );
}
