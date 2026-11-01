'use client';

/**
 * The WhatsApp connection, kept here instead of in the server's environment: where the gateway (OpenWA) is, its key, and
 * the phone linked to it by scanning a QR code. One WhatsApp number sends for every society, which is why this is a
 * platform setting and not one in a society's own settings. Saved settings win over the WHATSAPP_* variables; "Use the
 * server's settings" forgets them. The API never sends the key back, so the field stays empty and blank means "keep it".
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { platformApi } from '@/lib/api/endpoints';
import type { WhatsappConnection, WhatsappGatewayView } from '@/lib/reminders';
import { Card, DButton, Loading } from './ui';

const inputClass =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

const LINKING = ['initializing', 'authenticating', 'qr_ready'];

const errorText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};

export function WhatsappConnectionCard() {
  const qc = useQueryClient();
  const { data: gateway } = useQuery({
    queryKey: ['platform-whatsapp-gateway'],
    queryFn: () => platformApi.whatsappGateway().then((r: any) => (r.data ?? r) as WhatsappGatewayView),
  });
  const [url, setUrl] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [linking, setLinking] = useState(false);

  const { data: conn } = useQuery({
    queryKey: ['platform-whatsapp-connection'],
    queryFn: () => platformApi.whatsappConnection().then((r: any) => (r.data ?? r) as WhatsappConnection),
    // quickly while a phone is being linked (so the QR code appears at once), slowly otherwise
    refetchInterval: (q) => (linking || LINKING.includes((q.state.data as WhatsappConnection | undefined)?.status ?? '') ? 3_000 : 20_000),
  });
  useEffect(() => {
    if (conn?.status === 'ready') setLinking(false);
  }, [conn?.status]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform-whatsapp-gateway'] });
    qc.invalidateQueries({ queryKey: ['platform-whatsapp-connection'] });
  };

  const save = useMutation({
    mutationFn: () => platformApi.saveWhatsappGateway({ url: (url ?? gateway?.url ?? gateway?.environment.url ?? '').trim(), apiKey: key === '' ? null : key }),
    onSuccess: () => {
      toast.success('Gateway saved. Now press Connect a phone.');
      setKey('');
      setUrl(null);
      refresh();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not save the gateway')),
  });
  const connect = useMutation({
    mutationFn: () => platformApi.connectWhatsapp().then((r: any) => r.data ?? r),
    onMutate: () => setLinking(true),
    onSuccess: refresh,
    onError: (e: any) => {
      setLinking(false);
      toast.error(errorText(e, 'Could not start linking'));
    },
  });
  const disconnect = useMutation({
    mutationFn: () => platformApi.disconnectWhatsapp().then((r: any) => r.data ?? r),
    onSuccess: () => {
      toast.success('Phone unlinked');
      refresh();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not unlink the phone')),
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
  const status = conn?.status ?? null;

  return (
    <Card title="WhatsApp messages" icon={MessageCircle}>
      <div className="space-y-5">
        <p className="text-sm text-gray-400">
          One WhatsApp number sends bill, reminder, late-fine and payment messages for every society. Enter where the WhatsApp
          gateway (OpenWA) is running and its key, then link the phone by scanning a QR code. Use a dedicated number, not a
          personal one. Each society switches the messages on in its own Settings → Billing Rules → WhatsApp.
        </p>
        {gateway.source === 'environment' && (
          <p className="rounded-lg bg-gray-800/60 px-3 py-2 text-xs text-gray-300">
            Using the server&apos;s own settings ({gateway.environment.url}). Save a gateway here to use it instead.
          </p>
        )}
        {gateway.source === 'none' && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">No WhatsApp gateway is set, so no WhatsApp message can be sent yet.</p>
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
            <p className="mt-1 text-xs text-gray-500">OpenWA&apos;s admin key (shown once on its first start)</p>
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

        {gateway.source === 'console' && (
          <div className="space-y-4 border-t border-gray-800 pt-4">
            {conn?.problem && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{conn.problem}</p>
            )}

            {status === 'ready' ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-500/10 px-3 py-3">
                <p className="flex items-center gap-2 text-sm text-emerald-200">
                  <CheckCircle2 size={16} />
                  Linked{conn?.phone ? ` to +${conn.phone}` : ''}. It stays linked; you only scan again if you unlink it on the phone.
                </p>
                <DButton variant="outline" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  Unlink this phone
                </DButton>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <DButton variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
                    {status === 'qr_ready' ? 'Get a fresh QR code' : 'Connect a phone'}
                  </DButton>
                  <span className="text-xs text-gray-400">
                    {conn?.problem
                      ? ''
                      : status === 'qr_ready'
                        ? 'Waiting for you to scan the code below.'
                        : status === 'initializing' || status === 'authenticating' || linking
                          ? 'Starting… the QR code appears in a moment.'
                          : status
                            ? `Not linked (${status}).`
                            : 'Not linked yet.'}
                  </span>
                </div>
                {conn?.qrCode && (
                  <div className="flex flex-wrap items-center gap-5 rounded-lg border border-gray-800 bg-gray-900/60 p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={conn.qrCode} alt="WhatsApp QR code to scan" className="h-52 w-52 rounded bg-white p-1" />
                    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-300">
                      <li>On the phone with the number you want to send from, open WhatsApp.</li>
                      <li>Tap the menu, then <strong>Linked devices</strong>, then <strong>Link a device</strong>.</li>
                      <li>Scan this code. It refreshes by itself every few seconds.</li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
