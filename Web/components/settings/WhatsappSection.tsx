'use client';

/**
 * WhatsApp, in one place under Settings → Billing Rules: the wording of the payment reminder, and the automatic
 * messages (switch, reminder days, a test, what was sent), saved together with one button.
 *
 * Linking the phone (the gateway's address and key, the QR code) is not here. One WhatsApp number serves every society,
 * so that is a platform setting, in the Platform console under Settings.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { billingApi, societyApi, whatsappApi } from '@/lib/api/endpoints';
import {
  WHATSAPP_KIND_LABEL, parseReminderDays, previewReminder,
} from '@/lib/reminders';
import type {
  ReminderTemplate, WhatsappMessageRow, WhatsappStatus,
} from '@/lib/reminders';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${checked ? 'bg-primary-600' : 'bg-slate-200'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2 pt-1">
    <Bell size={14} className="text-slate-400" />
    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h4>
    <div className="h-px flex-1 bg-slate-200" />
  </div>
);

const errorText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};

export function WhatsappSection({ admin }: { admin: boolean }) {
  const qc = useQueryClient();

  const { data: config } = useQuery({ queryKey: ['society-config'], queryFn: () => societyApi.getConfig().then((r: any) => r.data ?? r) });
  const { data: tplData } = useQuery({
    queryKey: ['reminder-template'],
    queryFn: () => billingApi.getReminderTemplate().then((r: any) => (r.data ?? r) as ReminderTemplate),
  });
  const { data: status } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => whatsappApi.status().then((r: any) => (r.data ?? r) as WhatsappStatus),
    refetchInterval: 20_000,
  });
  const { data: messages } = useQuery({
    queryKey: ['whatsapp-messages'],
    queryFn: () => whatsappApi.messages(12).then((r: any) => (r.data ?? r) as WhatsappMessageRow[]),
    refetchInterval: 20_000,
  });

  // null = not edited yet: show what the server has, so a refetch cannot throw away what is being typed.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [tpl, setTpl] = useState<string | null>(null);
  const saved = (config?.additionalConfig as any)?.whatsapp;
  const shownEnabled = enabled ?? saved?.enabled === true;
  const shownDays = days ?? (saved?.reminderDays ?? [5, 10]).join(', ');
  const shownTpl = tpl ?? tplData?.template ?? '';
  const dirty = enabled !== null || days !== null || tpl !== null;

  const save = useMutation({
    mutationFn: () =>
      societyApi.updateConfig({
        whatsappEnabled: shownEnabled,
        whatsappReminderDays: parseReminderDays(shownDays),
        // Wording the same as the standard is stored as "unset", so the society follows the standard if it improves.
        ...(tpl !== null ? { reminderTemplate: tpl.trim() === tplData?.defaultTemplate.trim() ? '' : tpl.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('WhatsApp settings saved');
      setEnabled(null);
      setDays(null);
      setTpl(null);
      qc.invalidateQueries({ queryKey: ['society-config'] });
      qc.invalidateQueries({ queryKey: ['reminder-template'] });
      qc.invalidateQueries({ queryKey: ['billing-period-reminders'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not save the WhatsApp settings')),
  });

  const [testPhone, setTestPhone] = useState('');
  const test = useMutation({
    mutationFn: () => whatsappApi.test(testPhone).then((r: any) => r.data ?? r),
    onSuccess: (r: { sent: boolean; error?: string }) => {
      if (r.sent) toast.success('Test message sent. Check that phone.');
      else toast.error(r.error ?? 'The test message could not be sent');
      qc.invalidateQueries({ queryKey: ['whatsapp-messages'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
    },
    onError: (e: any) => toast.error(errorText(e, 'The test message could not be sent')),
  });

  const addToken = (token: string) => setTpl(`${shownTpl}${shownTpl && !/\s$/.test(shownTpl) ? ' ' : ''}${token}`);

  return (
    <div className="space-y-5">

      <Heading>Reminder wording</Heading>
      <div className="space-y-3 rounded-lg border border-green-100 bg-green-50 p-4">
        <p className="text-xs text-green-800">
          The message sent to a flat that has not paid. Each flat gets its own details filled in. It goes to the tenant when
          the flat has one, otherwise to the owner. WhatsApp shows <code>*text*</code> in bold and <code>_text_</code> in italics.
        </p>
        <div className="flex flex-wrap gap-1.5" aria-label="Details you can put in the message">
          {(tplData?.placeholders ?? []).map((p) => (
            <button
              key={p.token}
              type="button"
              disabled={!admin}
              title={`${p.token}: ${p.meaning}. Click to add it at the end.`}
              onClick={() => addToken(p.token)}
              className="rounded-full border border-green-200 bg-white px-2.5 py-1 font-mono text-[11px] text-green-800 hover:bg-green-100 disabled:opacity-50"
            >
              {p.token}
            </button>
          ))}
        </div>
        <Textarea label="Message" rows={9} maxLength={1500} value={shownTpl} disabled={!admin} onChange={(e) => setTpl(e.target.value)} />
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">How it looks for one flat</p>
          <pre className="whitespace-pre-wrap rounded-lg border border-green-100 bg-white p-3 font-sans text-xs text-slate-800">
            {previewReminder(shownTpl) || 'Nothing yet: the standard wording will be used.'}
          </pre>
        </div>
        {admin && tplData && shownTpl.trim() !== tplData.defaultTemplate.trim() && (
          <button type="button" onClick={() => setTpl(tplData.defaultTemplate)} className="text-xs font-medium text-green-800 underline hover:text-green-900">
            Go back to the standard wording
          </button>
        )}
      </div>

      <Heading>Automatic messages</Heading>
      <div className="space-y-3 rounded-lg border border-green-100 bg-green-50 p-4">
        <p className="text-xs text-green-800">
          Sends WhatsApp messages by itself: when the bills are published, as a reminder on the days below if a flat has not
          paid, when a late fine is added, and when a payment is received. They go to the tenant when the flat has one,
          otherwise the owner. Messages are sent one at a time, between 9 am and 8 pm only.
        </p>

        {status && !status.allowed && (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            WhatsApp messages are not switched on for your society. The platform owner allows them one society at a time. Until
            then nothing is sent from here; the reminder wording above still works for WhatsApp links you send by hand.
          </p>
        )}

        <div className="rounded-lg border border-green-100 bg-white px-3 py-2 text-xs text-slate-700">
          {!status ? (
            'Checking the WhatsApp connection…'
          ) : !status.configured ? (
            <span className="text-amber-700">
              WhatsApp is not connected yet.{' '}
              The platform owner links a phone once, in the Platform console under Settings; until then nothing is sent.
            </span>
          ) : status.session === 'ready' ? (
            <span className="text-green-700">
              Connected{status.sendingFrom ? ` — sending from +${status.sendingFrom}` : ''}. {status.sentToday} sent today,{' '}
              {status.queued} waiting{status.failedThisWeek > 0 ? `, ${status.failedThisWeek} failed this week` : ''}.
            </span>
          ) : (
            <span className="text-amber-700">
              WhatsApp is not ready ({status.session ?? status.problem ?? 'unknown'}). Messages wait in the queue and go out once it
              reconnects.
            </span>
          )}
        </div>

        <div className="flex items-start justify-between rounded-lg border border-green-100 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-800">Send WhatsApp messages automatically</p>
            <p className="text-xs text-slate-500">Off until you switch it on. Turning it off stops anything still waiting.</p>
          </div>
          <Toggle checked={shownEnabled} onChange={setEnabled} disabled={!admin || (status ? !status.configured || !status.allowed : false)} />
        </div>

        <div>
          <Input
            label="Send reminders on these days of the month"
            value={shownDays}
            onChange={(e) => setDays(e.target.value)}
            disabled={!admin}
            placeholder="5, 10"
            hint="Days 1 to 28, separated by commas. Only flats that have not paid are reminded, once a day."
          />
          <p className="mt-1 text-[11px] text-green-800">
            The late-fine message goes out when the fine is actually added: the day after the due date plus the grace days in
            Billing. Set grace days to 0 if you want it on the 11th for a due date of the 10th.
          </p>
        </div>

        {admin && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Send a test message to" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="98765 43210" inputMode="tel" />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => test.mutate()}
              loading={test.isPending}
              disabled={testPhone.replace(/\D/g, '').length < 8 || !status?.configured || !status?.allowed}
            >
              Send test
            </Button>
          </div>
        )}

        {(messages ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Latest messages</p>
            <ul className="divide-y divide-green-100 rounded-lg border border-green-100 bg-white text-xs">
              {(messages ?? []).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-700">
                    {WHATSAPP_KIND_LABEL[m.kind] ?? m.kind} · +{m.toPhone}
                  </span>
                  <span
                    title={m.lastError ?? undefined}
                    className={m.status === 'SENT' ? 'text-green-700' : m.status === 'FAILED' ? 'text-red-600' : 'text-amber-700'}
                  >
                    {m.status === 'SENT' ? 'Sent' : m.status === 'FAILED' ? 'Failed' : 'Waiting'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {admin && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty} size="sm">
            <Save size={14} className="mr-1.5" /> Save WhatsApp Settings
          </Button>
        </div>
      )}
    </div>
  );
}

