'use client';

/**
 * The outgoing-mail login, kept here instead of in the server's environment so
 * it can be fixed without a redeploy. Saved settings win over the SMTP_*
 * variables; "Use the server's settings" forgets them. The API never sends the
 * password back — only whether one is saved — so the field stays empty and a
 * blank means "keep what is saved".
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { platformApi, type MailSettingsInput } from '@/lib/api/endpoints';
import { Card, DButton, Loading } from './ui';

const inputClass =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

type Form = { host: string; port: string; username: string; password: string; fromAddress: string; fromName: string };

export function MailSettingsCard() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);

  const { data } = useQuery({ queryKey: ['platform-mail-settings'], queryFn: () => platformApi.mailSettings().then((r) => r.data) });

  // Start from what is saved; when nothing is, from the server's login so only the password is missing.
  useEffect(() => {
    if (!data || form) return;
    const saved = data.source === 'console';
    setForm({
      host: saved ? (data.host ?? '') : (data.environment.host ?? ''),
      port: String(saved ? (data.port ?? 465) : (data.environment.port ?? 465)),
      username: saved ? (data.username ?? '') : (data.environment.user ?? ''),
      password: '',
      fromAddress: data.fromAddress ?? '',
      fromName: data.fromName ?? '',
    });
  }, [data, form]);

  const onError = (e: any) => {
    const m = e?.response?.data?.message;
    toast.error(Array.isArray(m) ? m.join(', ') : (m ?? 'Could not save the mail settings'));
  };

  const save = useMutation({
    mutationFn: (body: MailSettingsInput) => platformApi.saveMailSettings(body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-mail-settings'] });
      setForm((f) => (f ? { ...f, password: '' } : f));
      toast.success('Mail settings saved. Use "Check email" below to prove they work.');
    },
    onError,
  });

  const clear = useMutation({
    mutationFn: () => platformApi.clearMailSettings().then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-mail-settings'] });
      setForm(null);
      toast.success("Back to the server's own mail settings.");
    },
    onError,
  });

  if (!data || !form) return <Loading />;

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const port = Number(form.port);
  const portOk = Number.isInteger(port) && port >= 1 && port <= 65535;
  const needsPassword = form.username.trim() !== '' && !data.hasPassword && form.password === '';
  const canSave = form.host.trim() !== '' && portOk && !needsPassword;

  const sourceNote =
    data.source === 'console'
      ? 'Email is being sent with the settings saved here.'
      : data.source === 'environment'
        ? `Email is being sent with the server's own settings (${data.environment.host}). Save settings here to use these instead.`
        : 'No mail server is set, so no email can be sent yet.';

  return (
    <Card title="Email server (SMTP)" icon={Mail}>
      <div className="space-y-5">
        <p className="text-sm text-gray-400">
          The mail login that sends password-reset and invite emails. Saved here, it takes effect straight away — no
          redeploy — and replaces the server&apos;s SMTP settings.
        </p>
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            data.source === 'none' ? 'bg-amber-500/10 text-amber-200' : 'bg-gray-800/60 text-gray-300'
          }`}
        >
          {sourceNote}
        </p>
        {data.passwordUnreadable && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            The saved password can no longer be read because the server&apos;s secret key changed. Type the password again and save.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <div>
            <label htmlFor="smtp-host" className="mb-1 block text-xs font-medium text-gray-300">Mail server</label>
            <input id="smtp-host" value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.example.com" autoComplete="off" className={inputClass} />
          </div>
          <div>
            <label htmlFor="smtp-port" className="mb-1 block text-xs font-medium text-gray-300">Port</label>
            <input id="smtp-port" inputMode="numeric" value={form.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} aria-invalid={!portOk} className={inputClass} />
          </div>
        </div>
        <p className="-mt-3 text-xs text-gray-500">465 connects over SSL. 587 starts plain and upgrades to TLS. Use whichever your provider lists.</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="smtp-user" className="mb-1 block text-xs font-medium text-gray-300">Username</label>
            <input id="smtp-user" value={form.username} onChange={(e) => set({ username: e.target.value })} placeholder="support@example.com" autoComplete="off" className={inputClass} />
          </div>
          <div>
            <label htmlFor="smtp-pass" className="mb-1 block text-xs font-medium text-gray-300">Password</label>
            <input
              id="smtp-pass"
              type="password"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder={data.hasPassword && !data.passwordUnreadable ? 'Saved — leave blank to keep it' : ''}
              autoComplete="new-password"
              aria-invalid={needsPassword}
              className={inputClass}
            />
            {needsPassword && <p className="mt-1 text-xs text-amber-400">Enter the password for this login.</p>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="smtp-from" className="mb-1 block text-xs font-medium text-gray-300">From address</label>
            <input id="smtp-from" value={form.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} placeholder="Same as the username" autoComplete="off" className={inputClass} />
          </div>
          <div>
            <label htmlFor="smtp-name" className="mb-1 block text-xs font-medium text-gray-300">From name</label>
            <input id="smtp-name" value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="NG Home" maxLength={80} className={inputClass} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {data.source === 'console' ? (
            <DButton variant="outline" loading={clear.isPending} onClick={() => clear.mutate()}>
              Use the server&apos;s settings instead
            </DButton>
          ) : (
            <span />
          )}
          <DButton
            variant="primary"
            loading={save.isPending}
            disabled={!canSave}
            onClick={() =>
              save.mutate({
                host: form.host.trim(),
                port,
                username: form.username.trim() || null,
                password: form.password === '' ? null : form.password,
                fromAddress: form.fromAddress.trim() || null,
                fromName: form.fromName.trim() || null,
              })
            }
          >
            Save mail settings
          </DButton>
        </div>
      </div>
    </Card>
  );
}
