'use client';

/**
 * The WhatsApp gateway, kept here instead of in the server's environment: where it is (OpenWA) and its key. It is the
 * platform's alone. Each society links its own number as its own session on this gateway, from its own settings
 * (Settings → Billing Rules → WhatsApp), so one society's messages never go out from another's number. This card also shows
 * which societies have linked a number and whether each is connected, since every session uses memory on the gateway.
 * Saved settings win over the WHATSAPP_* variables; "Use the server's settings" forgets them. The API never sends the key
 * back, so the field stays empty and blank means "keep it".
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { platformApi } from '@/lib/api/endpoints';
import type { WhatsappGatewayView, WhatsappSessionsOverview } from '@/lib/reminders';
import { Card, DButton, Loading, Pill } from './ui';

const inputClass =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

const errorText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};

const statusTone = (status: string | null): 'green' | 'amber' | 'red' | 'slate' =>
  status === 'ready' ? 'green' : status === 'qr_ready' || status === 'initializing' || status === 'authenticating' ? 'amber' : status === 'missing' || status === 'failed' ? 'red' : 'slate';

const statusLabel = (status: string | null) =>
  status === 'ready' ? 'Connected' : status === 'qr_ready' ? 'Waiting for QR scan' : status === 'missing' ? 'Gone from the gateway' : status === null ? '—' : status.replace(/_/g, ' ');

export function WhatsappConnectionCard() {
  const qc = useQueryClient();
  const { data: gateway } = useQuery({
    queryKey: ['platform-whatsapp-gateway'],
    queryFn: () => platformApi.whatsappGateway().then((r: any) => (r.data ?? r) as WhatsappGatewayView),
  });
  const { data: overview } = useQuery({
    queryKey: ['platform-whatsapp-sessions'],
    queryFn: () => platformApi.whatsappSessions().then((r: any) => (r.data ?? r) as WhatsappSessionsOverview),
    refetchInterval: 20_000,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [key, setKey] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform-whatsapp-gateway'] });
    qc.invalidateQueries({ queryKey: ['platform-whatsapp-sessions'] });
  };

  const save = useMutation({
    mutationFn: () => platformApi.saveWhatsappGateway({ url: (url ?? gateway?.url ?? gateway?.environment.url ?? '').trim(), apiKey: key === '' ? null : key }),
    onSuccess: () => {
      toast.success('Gateway saved. Each society can now link its own number.');
      setKey('');
      setUrl(null);
      refresh();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not save the gateway')),
  });
  const clear = useMutation({
    mutationFn: () => platformApi.clearWhatsappGateway().then((r: any) => r.data ?? r),
    onSuccess: () => {
      toast.success("Back to the server's own WhatsApp settings.");
      setUrl(null);
      refresh();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not remove the saved gateway')),
  });

  if (!gateway) return <Loading />;
  const shownUrl = url ?? gateway.url ?? gateway.environment.url ?? '';
  const canSave = shownUrl.trim() !== '' && (gateway.hasKey || key.trim() !== '');
  // A society that moved to its Meta account keeps its linked number stopped; it is listed once, as a Meta account.
  const viaMeta = overview?.cloud.filter((s) => !s.deleted) ?? [];
  const linked = (overview?.sessions.filter((s) => !s.deleted && s.provider !== 'CLOUD') ?? []).length;
  const numbers = overview?.sessions.filter((s) => !s.deleted && s.provider !== 'CLOUD') ?? [];

  return (
    <Card title="WhatsApp messages" icon={MessageCircle}>
      <div className="space-y-5">
        <p className="text-sm text-gray-400">
          One WhatsApp gateway (OpenWA) serves every society that links a number, but <strong className="text-gray-200">each society
          uses its own number</strong>: it links it from its own Settings → Billing Rules → WhatsApp, or connects its own Meta WhatsApp
          Business account there instead, and its messages go out from that number only. Enter where the gateway is running and its key
          here, once (only needed for linked numbers). A society can use WhatsApp either way only after you allow it on the Societies
          page (every society starts Off).
        </p>
        {gateway.source === 'environment' && (
          <p className="rounded-lg bg-gray-800/60 px-3 py-2 text-xs text-gray-300">
            Using the server&apos;s own settings ({gateway.environment.url}). Save a gateway here to use it instead.
          </p>
        )}
        {gateway.source === 'none' && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">No WhatsApp gateway is set, so no society can link a number yet.</p>
        )}
        {gateway.keyUnreadable && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            The saved key can no longer be read because the server&apos;s secret key changed. Type the key again and save.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="wa-url" className="mb-1 block text-xs font-medium text-gray-300">Gateway address</label>
            <input id="wa-url" value={shownUrl} onChange={(e) => setUrl(e.target.value)} placeholder="http://openwa:2785" autoComplete="off" className={inputClass} />
            <p className="mt-1 text-xs text-gray-500">Where this server reaches OpenWA, with http:// or https://</p>
          </div>
          <div>
            <label htmlFor="wa-key" className="mb-1 block text-xs font-medium text-gray-300">Gateway API key</label>
            <input
              id="wa-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={gateway.hasKey && !gateway.keyUnreadable ? 'Saved — leave blank to keep it' : ''}
              autoComplete="new-password"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500">OpenWA&apos;s admin key (the one you set as OPENWA_API_KEY)</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {gateway.source === 'console' ? (
            <DButton variant="outline" loading={clear.isPending} onClick={() => clear.mutate()}>
              Use the server&apos;s settings instead
            </DButton>
          ) : (
            <span />
          )}
          <DButton variant="primary" loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
            Save gateway
          </DButton>
        </div>

        {/* Who has linked a number */}
        <div className="space-y-3 border-t border-gray-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-200">Linked numbers</h3>
            {overview && (
              <span className="text-xs text-gray-500">
                {overview.configured ? (overview.reachable ? `${linked} linked, ${viaMeta.length} on Meta` : 'Gateway not reachable') : `No gateway set, ${viaMeta.length} on Meta`}
              </span>
            )}
          </div>
          {overview?.problem && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{overview.problem}</p>
          )}
          {overview?.configured && numbers.length === 0 && viaMeta.length === 0 && !overview.problem && (
            <p className="text-xs text-gray-500">No society has linked a number yet. Allow a society on the Societies page; its admin links the number from their own Settings.</p>
          )}
          {(numbers.length > 0 || viaMeta.length > 0) && (
            <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800 text-sm">
              {viaMeta.map((s) => (
                <li key={`meta-${s.societyId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-gray-200">{s.name}</span>
                  <span className="flex items-center gap-3 text-xs text-gray-400">
                    {s.phone && <span className="font-mono">+{s.phone}</span>}
                    {!s.allowed && <Pill tone="slate">Off</Pill>}
                    <Pill tone="green">Meta WhatsApp Business</Pill>
                  </span>
                </li>
              ))}
              {numbers.map((s) => (
                <li key={s.societyId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-gray-200">{s.name}</span>
                  <span className="flex items-center gap-3 text-xs text-gray-400">
                    {s.phone && <span className="font-mono">+{s.phone}</span>}
                    {!s.allowed && <Pill tone="slate">Off</Pill>}
                    <Pill tone={statusTone(s.status)}>{statusLabel(s.status)}</Pill>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(overview?.orphans.length ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {overview?.orphans.length} session{overview?.orphans.length === 1 ? '' : 's'} on the gateway belong{overview?.orphans.length === 1 ? 's' : ''} to no society
              ({overview?.orphans.map((o) => o.name).join(', ')}). Each one uses memory for nothing; remove it in the OpenWA dashboard.
            </div>
          )}
          <p className="text-xs text-gray-500">
            Each linked number runs its own browser inside OpenWA and uses roughly 300–500 MB of memory, so allow only as many
            of those as the server can carry. A society on its own Meta WhatsApp Business account uses nothing on the gateway
            and pays Meta directly; the same Allowed switch governs both ways.
          </p>
        </div>
      </div>
    </Card>
  );
}
