'use client';

/**
 * WhatsApp, in one place under Settings → Billing Rules: the wording of the payment reminder, and the automatic
 * messages (switch, reminder days, a test, what was sent), saved together with one button.
 *
 * Each society uses its OWN WhatsApp number, once the platform owner has allowed the society, in one of two ways: link a
 * number by scanning a QR code (OpenWA, free, unofficial), or connect its own Meta WhatsApp Business account (the official
 * Cloud API: approved message templates, billed by Meta). Its messages go out from that number only. The gateway's address and
 * key are the platform's, set in the Platform console.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { billingApi, societyApi, whatsappApi } from '@/lib/api/endpoints';
import {
  WHATSAPP_KIND_LABEL, parseReminderDays, previewReminder,
} from '@/lib/reminders';
import type {
  ReminderTemplate, WhatsappCloud, WhatsappConnection, WhatsappMessageRow, WhatsappStatus,
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
  const [finalTpl, setFinalTpl] = useState<string | null>(null);
  const saved = (config?.additionalConfig as any)?.whatsapp;
  const shownEnabled = enabled ?? saved?.enabled === true;
  const shownDays = days ?? (saved?.reminderDays ?? [5, 10]).join(', ');
  const shownTpl = tpl ?? tplData?.template ?? '';
  // An older server does not know the second reminder: then there is nothing to show or save for it.
  const hasSecond = tplData?.finalTemplate !== undefined && tplData?.defaultFinalTemplate !== undefined;
  const shownFinal = finalTpl ?? tplData?.finalTemplate ?? '';
  const dirty = enabled !== null || days !== null || tpl !== null || finalTpl !== null;

  const save = useMutation({
    mutationFn: () =>
      societyApi.updateConfig({
        whatsappEnabled: shownEnabled,
        whatsappReminderDays: parseReminderDays(shownDays),
        // Wording the same as the standard is stored as "unset", so the society follows the standard if it improves.
        ...(tpl !== null ? { reminderTemplate: tpl.trim() === tplData?.defaultTemplate.trim() ? '' : tpl.trim() } : {}),
        ...(finalTpl !== null && hasSecond ? { finalReminderTemplate: finalTpl.trim() === tplData?.defaultFinalTemplate?.trim() ? '' : finalTpl.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('WhatsApp settings saved');
      setEnabled(null);
      setDays(null);
      setTpl(null);
      setFinalTpl(null);
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
  const addFinalToken = (token: string) => setFinalTpl(`${shownFinal}${shownFinal && !/\s$/.test(shownFinal) ? ' ' : ''}${token}`);

  return (
    <div className="space-y-5">
      {status?.allowed && <SendingWayPanel admin={admin} status={status} />}

      <Heading>{hasSecond ? 'First reminder wording' : 'Reminder wording'}</Heading>
      <div className="space-y-3 rounded-lg border border-green-100 bg-green-50 p-4">
        <p className="text-xs text-green-800">
          The message sent to a flat that has not paid. Each flat gets its own details filled in. It goes to the tenant when
          the flat has one, otherwise to the owner. WhatsApp shows <code>*text*</code> in bold and <code>_text_</code> in italics.
        </p>
        {status?.provider === 'CLOUD' && (
          <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Your society sends through its WhatsApp Business account, which can only send message templates that Meta approved
            beforehand. The automatic reminders therefore use the approved templates, and this wording applies only to WhatsApp
            links you send by hand from a bill.
          </p>
        )}
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

      {hasSecond && (
        <>
          <Heading>Second reminder wording</Heading>
          <div className="space-y-3 rounded-lg border border-green-100 bg-green-50 p-4">
            <p className="text-xs text-green-800">
              Sent on a later reminder day to a flat that was already reminded about this bill and still has not paid. A flat
              reminded for the first time always gets the first wording, whichever day it is. Everything above about the details
              you can use applies here too.
            </p>
            {status?.provider === 'CLOUD' && (
              <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Through your WhatsApp Business account the second reminder goes as the optional approved template
                <span className="font-mono"> ng_payment_reminder_final</span> once Meta has approved it (see the templates below), and as the
                usual reminder template until then. This wording applies only to links you send by hand.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5" aria-label="Details you can put in the second reminder">
              {(tplData?.placeholders ?? []).map((p) => (
                <button
                  key={p.token}
                  type="button"
                  disabled={!admin}
                  title={`${p.token}: ${p.meaning}. Click to add it at the end.`}
                  onClick={() => addFinalToken(p.token)}
                  className="rounded-full border border-green-200 bg-white px-2.5 py-1 font-mono text-[11px] text-green-800 hover:bg-green-100 disabled:opacity-50"
                >
                  {p.token}
                </button>
              ))}
            </div>
            <Textarea label="Second reminder message" rows={9} maxLength={1500} value={shownFinal} disabled={!admin} onChange={(e) => setFinalTpl(e.target.value)} />
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">How it looks for one flat</p>
              <pre className="whitespace-pre-wrap rounded-lg border border-green-100 bg-white p-3 font-sans text-xs text-slate-800">
                {previewReminder(shownFinal) || 'Nothing yet: the standard wording will be used.'}
              </pre>
            </div>
            {admin && tplData?.defaultFinalTemplate && shownFinal.trim() !== tplData.defaultFinalTemplate.trim() && (
              <button type="button" onClick={() => setFinalTpl(tplData.defaultFinalTemplate!)} className="text-xs font-medium text-green-800 underline hover:text-green-900">
                Go back to the standard second reminder
              </button>
            )}
          </div>
        </>
      )}

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
              WhatsApp has not been set up on the platform yet. The platform owner adds the gateway in the Platform console; until
              then nothing is sent. You can connect your own WhatsApp Business account above instead.
            </span>
          ) : !status.hasSession ? (
            <span className="text-amber-700">
              {status.provider === 'CLOUD'
                ? 'Your WhatsApp Business account is not connected yet. Enter its details above.'
                : 'Your WhatsApp number is not linked yet. Press Connect a phone above and scan the code.'}
            </span>
          ) : status.session === 'ready' ? (
            <span className="text-green-700">
              Connected{status.sendingFrom ? ` — sending from your ${status.provider === 'CLOUD' ? 'WhatsApp Business number' : 'number'} +${status.sendingFrom}` : ''}. {status.sentToday} sent today,{' '}
              {status.queued} waiting{status.failedThisWeek > 0 ? `, ${status.failedThisWeek} failed this week` : ''}.
              {status.provider === 'CLOUD' && status.templatesReady === false && (
                <span className="mt-1 block text-amber-700">
                  Meta has not approved the message templates yet, so messages wait until it does. Check them above.
                </span>
              )}
            </span>
          ) : (
            <span className="text-amber-700">
              {status.provider === 'CLOUD'
                ? `Meta is not accepting your account right now (${status.problem ?? status.session ?? 'unknown'}). Messages wait in the queue and go out once it works again.`
                : `WhatsApp is not ready (${status.session ?? status.problem ?? 'unknown'}). Messages wait in the queue and go out once it reconnects.`}
            </span>
          )}
        </div>

        <div className="flex items-start justify-between rounded-lg border border-green-100 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-800">Send WhatsApp messages automatically</p>
            <p className="text-xs text-slate-500">Off until you switch it on. Turning it off stops anything still waiting.</p>
          </div>
          <Toggle checked={shownEnabled} onChange={setEnabled} disabled={!admin || (status ? !status.configured || !status.allowed || !status.hasSession : false)} />
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
              disabled={testPhone.replace(/\D/g, '').length < 8 || !status?.configured || !status?.allowed || !status?.hasSession}
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


/* ─── This society's own number ──────────────────────────────────────────────────────────────────────────────────── */

const LINKING = ['initializing', 'authenticating', 'qr_ready'];

function ConnectionPanel({ admin, onChanged, inUse, onUse, using }: { admin: boolean; onChanged: () => void; inUse: boolean; onUse: () => void; using: boolean }) {
  const qc = useQueryClient();
  const [linking, setLinking] = useState(false);

  const { data: conn } = useQuery({
    queryKey: ['whatsapp-connection'],
    queryFn: () => whatsappApi.connection().then((r: any) => (r.data ?? r) as WhatsappConnection),
    // quickly while the number is being linked (so the QR code appears at once), slowly otherwise
    refetchInterval: (q) => (linking || LINKING.includes((q.state.data as WhatsappConnection | undefined)?.status ?? '') ? 3_000 : 20_000),
  });
  useEffect(() => {
    if (conn?.status === 'ready') setLinking(false);
  }, [conn?.status]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    onChanged();
  };
  const connect = useMutation({
    mutationFn: () => whatsappApi.connect().then((r: any) => r.data ?? r),
    onMutate: () => setLinking(true),
    onSuccess: refresh,
    onError: (e: any) => {
      setLinking(false);
      toast.error(errorText(e, 'Could not start linking'));
    },
  });
  const disconnect = useMutation({
    mutationFn: () => whatsappApi.disconnect().then((r: any) => r.data ?? r),
    onSuccess: () => {
      toast.success('Number unlinked');
      refresh();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not unlink the number')),
  });

  const status = conn?.status ?? null;
  if (conn && !conn.hasGateway) {
    return (
      <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Linking a number by QR code is not set up on this platform yet; the platform owner adds the WhatsApp gateway in the
        Platform console. You can connect your own WhatsApp Business account instead.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Free and quick to set up. Messages go out from a WhatsApp number that belongs to your society, not from anyone else&apos;s.
        Use a dedicated number (an inexpensive SIM), not a personal one. It is an unofficial connection, so WhatsApp can
        restrict a number that sends too much; NG Home sends slowly, in the daytime only, to keep that risk low.
      </p>
      {conn?.problem && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{conn.problem}</p>}

      {status === 'ready' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 px-3 py-3">
          <p className="flex items-center gap-2 text-sm text-green-800">
            <CheckCircle2 size={16} />
            Linked{conn?.phone ? ` to +${conn.phone}` : ''}. It stays linked; you only scan again if you unlink it on the phone.
          </p>
          {admin && (
            <div className="flex flex-wrap items-center gap-2">
              {!inUse && (
                <Button size="sm" onClick={onUse} loading={using}>
                  Send my messages from this number
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => disconnect.mutate()} loading={disconnect.isPending}>
                Unlink this number
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {admin && (
              <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending}>
                {status === 'qr_ready' ? 'Get a fresh QR code' : 'Connect a phone'}
              </Button>
            )}
            <span className="text-xs text-slate-500">
              {conn?.problem
                ? ''
                : status === 'qr_ready'
                  ? 'Waiting for you to scan the code below.'
                  : status === 'initializing' || status === 'authenticating' || linking
                    ? 'Starting… the QR code appears in a moment.'
                    : status
                      ? `Not linked (${status}).`
                      : admin
                        ? 'Not linked yet.'
                        : 'Not linked yet. Ask your society admin to connect it.'}
            </span>
          </div>
          {conn?.qrCode && (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={conn.qrCode} alt="WhatsApp QR code to scan" className="h-48 w-48 rounded bg-white" />
              <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600">
                <li>On the phone with the number you want to send from, open WhatsApp.</li>
                <li>Tap the menu, then <strong>Linked devices</strong>, then <strong>Link a device</strong>.</li>
                <li>Scan this code. It refreshes by itself every few seconds.</li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ─── How the society sends: its own linked number, or its own Meta account ──────────────────────────────────────── */

type Way = 'OPENWA' | 'CLOUD';

const WAYS: { way: Way; title: string; text: string }[] = [
  { way: 'OPENWA', title: 'Link my own number', text: 'Scan a QR code with a dedicated phone number. Free; an unofficial connection.' },
  { way: 'CLOUD', title: 'Official WhatsApp Business', text: 'Your own Meta WhatsApp Business account. Approved templates, billed by Meta; no ban risk.' },
];

function SendingWayPanel({ admin, status }: { admin: boolean; status: WhatsappStatus }) {
  const qc = useQueryClient();
  // Which way's panel is open; it starts on the way in use. Looking at the other does not change how messages are sent.
  const [view, setView] = useState<Way | null>(null);
  const shown = view ?? status.provider;
  const refresh = () => {
    for (const k of ['whatsapp-status', 'whatsapp-connection', 'whatsapp-cloud', 'whatsapp-messages']) qc.invalidateQueries({ queryKey: [k] });
  };
  const use = useMutation({
    mutationFn: (way: Way) => whatsappApi.setProvider(way).then((r: any) => r.data ?? r),
    onSuccess: (_r, way) => {
      toast.success(way === 'CLOUD' ? 'Messages now go out through your WhatsApp Business account' : 'Messages now go out from your linked number');
      refresh();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not change how messages are sent')),
  });

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-800">How your messages are sent</h4>
      <p className="text-xs text-slate-500">
        Pick one. Either way the messages come from your society&apos;s own number, never from another society&apos;s.
      </p>
      <div role="tablist" aria-label="How your messages are sent" className="grid gap-2 sm:grid-cols-2">
        {WAYS.map((w) => (
          <button
            key={w.way}
            type="button"
            role="tab"
            aria-selected={shown === w.way}
            onClick={() => setView(w.way)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${shown === w.way ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'}`}
          >
            <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-800">
              {w.title}
              {status.provider === w.way && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800">In use</span>}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">{w.text}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {shown === 'OPENWA' ? (
          <ConnectionPanel admin={admin} onChanged={refresh} inUse={status.provider === 'OPENWA'} onUse={() => use.mutate('OPENWA')} using={use.isPending} />
        ) : (
          <CloudPanel admin={admin} inUse={status.provider === 'CLOUD'} onUse={() => use.mutate('CLOUD')} using={use.isPending} onChanged={refresh} />
        )}
      </div>
    </div>
  );
}

const TEMPLATE_LABEL: Record<string, { text: string; tone: string }> = {
  APPROVED: { text: 'Approved', tone: 'bg-green-100 text-green-800' },
  PENDING: { text: 'Waiting for Meta', tone: 'bg-amber-100 text-amber-800' },
  IN_APPEAL: { text: 'In appeal', tone: 'bg-amber-100 text-amber-800' },
  REJECTED: { text: 'Rejected', tone: 'bg-red-100 text-red-700' },
  PAUSED: { text: 'Paused', tone: 'bg-red-100 text-red-700' },
  DISABLED: { text: 'Disabled', tone: 'bg-red-100 text-red-700' },
  NOT_SUBMITTED: { text: 'Not submitted', tone: 'bg-slate-100 text-slate-600' },
  UNKNOWN: { text: 'Not checked', tone: 'bg-slate-100 text-slate-600' },
};

const TEMPLATE_PURPOSE: Record<string, string> = {
  ng_bill_published: 'Bill is ready',
  ng_payment_reminder: 'Payment reminder',
  ng_payment_reminder_final: 'Second payment reminder',
  ng_late_fine: 'Late fine added',
  ng_payment_received: 'Payment received',
  ng_payment_receipt: 'Payment received, with a link to the receipt',
};

/** The society's own Meta WhatsApp Business account: connect it, see Meta's verdict on the message templates. */
function CloudPanel({ admin, inUse, onUse, using, onChanged }: { admin: boolean; inUse: boolean; onUse: () => void; using: boolean; onChanged: () => void }) {
  const { data: cloud } = useQuery({
    queryKey: ['whatsapp-cloud'],
    queryFn: () => whatsappApi.cloud().then((r: any) => (r.data ?? r) as WhatsappCloud),
    refetchInterval: 30_000,
  });
  const [editing, setEditing] = useState(false);
  const [phoneId, setPhoneId] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [waba, setWaba] = useState<string | null>(null);
  const shownPhoneId = phoneId ?? cloud?.phoneNumberId ?? '';
  const shownWaba = waba ?? cloud?.wabaId ?? '';

  const connect = useMutation({
    mutationFn: () =>
      whatsappApi
        .connectCloud({ phoneNumberId: shownPhoneId.trim(), ...(token.trim() ? { accessToken: token.trim() } : {}), ...(shownWaba.trim() ? { wabaId: shownWaba.trim() } : {}) })
        .then((r: any) => r.data ?? r),
    onSuccess: () => {
      toast.success('Connected. Messages now go out through your WhatsApp Business account.');
      setToken('');
      setPhoneId(null);
      setWaba(null);
      setEditing(false);
      onChanged();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not connect the account')),
  });
  const disconnect = useMutation({
    mutationFn: () => whatsappApi.disconnectCloud().then((r: any) => r.data ?? r),
    onSuccess: () => {
      toast.success('Account disconnected');
      onChanged();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not disconnect the account')),
  });
  const submit = useMutation({
    mutationFn: () => whatsappApi.submitCloudTemplates().then((r: any) => r.data ?? r),
    onSuccess: (r: { submitted: string[]; failed: { name: string; error: string }[] }) => {
      if (r.failed.length) toast.error(`Meta refused ${r.failed[0].name}: ${r.failed[0].error}`);
      else if (r.submitted.length) toast.success(`Sent ${r.submitted.length} template${r.submitted.length === 1 ? '' : 's'} to Meta for approval`);
      else toast.success('Nothing to send: all the templates are already on your account');
      onChanged();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not send the templates to Meta')),
  });

  const form = !cloud?.linked || editing;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        The official way: messages go out from your own WhatsApp Business number through Meta, so there is no QR code and no ban
        risk. Meta needs each kind of message approved first as a template, and charges your own Meta account for the messages it
        delivers (NG Home adds nothing). You need a Meta business account with a WhatsApp number registered to the Cloud API.
      </p>

      {cloud?.problem && cloud.status !== 'ready' && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{cloud.problem}</p>
      )}

      {cloud?.linked && !editing && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 px-3 py-3">
            <p className="flex items-center gap-2 text-sm text-green-800">
              <CheckCircle2 size={16} />
              {cloud.status === 'ready'
                ? `Connected${cloud.displayPhone ? ` to +${cloud.displayPhone}` : ''}${cloud.verifiedName ? ` (${cloud.verifiedName})` : ''}.`
                : 'Saved, but Meta is not accepting it right now.'}
            </p>
            {admin && (
              <div className="flex flex-wrap items-center gap-2">
                {!inUse && cloud.status === 'ready' && (
                  <Button size="sm" onClick={onUse} loading={using}>Send my messages through this account</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Change details</Button>
                <Button size="sm" variant="outline" onClick={() => disconnect.mutate()} loading={disconnect.isPending}>Disconnect</Button>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Message templates (Meta must approve each one)</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
              {(cloud.templates ?? []).map((t) => {
                const label = TEMPLATE_LABEL[t.status] ?? { text: t.status, tone: 'bg-slate-100 text-slate-600' };
                return (
                  <li key={t.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                    <span className="text-slate-700">
                      {TEMPLATE_PURPOSE[t.name] ?? t.name} <span className="font-mono text-[11px] text-slate-400">{t.name}</span>
                      {t.optional && <span className="ml-1 text-[11px] text-slate-400">(optional)</span>}
                    </span>
                    <span title={t.reason ?? undefined} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${label.tone}`}>{label.text}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {admin && cloud.wabaId && cloud.templates.some((t) => t.status === 'NOT_SUBMITTED') && (
                <Button size="sm" variant="secondary" onClick={() => submit.mutate()} loading={submit.isPending}>
                  Send the missing templates to Meta
                </Button>
              )}
              <span className="text-xs text-slate-500">
                {!cloud.wabaId
                  ? 'Add your WhatsApp Business Account ID (Change details) and NG Home can create these for you and show their approval here.'
                  : cloud.templatesReady
                    ? 'All approved. Your messages can go out.'
                    : 'Meta usually approves a template within minutes, sometimes up to a day. Messages wait until the required templates are approved; the optional receipt one only adds the receipt link, and the confirmation goes without it until Meta approves it.'}
              </span>
            </div>
          </div>
        </div>
      )}

      {form && admin && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Phone number ID" value={shownPhoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder="109876543210987" inputMode="numeric" autoComplete="off" />
            <Input label="WhatsApp Business Account ID" value={shownWaba} onChange={(e) => setWaba(e.target.value)} placeholder="208765432109876" inputMode="numeric" autoComplete="off" hint="Optional, but needed for NG Home to create the templates for you." />
          </div>
          <Input
            label="Access token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="new-password"
            placeholder={cloud?.linked ? 'Saved. Leave blank to keep it' : ''}
            hint="Stored encrypted and never shown again."
          />
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">Where do I find these?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>In <strong>Meta for Developers</strong>, open your app and go to <strong>WhatsApp → API Setup</strong>. Your <strong>Phone number ID</strong> and <strong>WhatsApp Business Account ID</strong> are shown there.</li>
              <li>The temporary token on that page lasts 24 hours. For a lasting one, open <strong>Meta Business Settings → Users → System users</strong>, add a system user, give it your WhatsApp account, and generate a token with the <strong>whatsapp_business_messaging</strong> and <strong>whatsapp_business_management</strong> permissions.</li>
              <li>The number must be registered to the Cloud API, and a payment method added in <strong>WhatsApp Manager</strong>, before Meta delivers business messages.</li>
            </ol>
          </details>
          <div className="flex flex-wrap justify-end gap-2">
            {cloud?.linked && <Button size="sm" variant="outline" onClick={() => { setEditing(false); setPhoneId(null); setWaba(null); setToken(''); }}>Cancel</Button>}
            <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending} disabled={!shownPhoneId.trim() || (!cloud?.linked && !token.trim())}>
              {cloud?.linked ? 'Save and check with Meta' : 'Connect to Meta'}
            </Button>
          </div>
        </div>
      )}
      {form && !admin && <p className="text-xs text-slate-500">Not connected yet. Ask your society admin to connect it.</p>}
    </div>
  );
}
