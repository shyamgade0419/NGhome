'use client';

/**
 * Online payments through the society's OWN Razorpay account (Settings → Society → Online payments). The admin pastes the
 * society's Razorpay keys; residents then see "Pay online" on their bills. The money goes from the resident to the
 * society's Razorpay account and on to its bank: NG Home never holds it. The secret is saved encrypted and never shown again.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { accountsApi, onlinePaymentsApi } from '@/lib/api/endpoints';
import { OUTCOME_LABEL } from '@/lib/onlinePayments';
import type { OnlineGateway, OnlineRecent } from '@/lib/onlinePayments';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { formatCurrency } from '@/lib/utils';

const errorText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};

export function OnlinePaymentsSection() {
  const qc = useQueryClient();
  const { data: gateway } = useQuery({
    queryKey: ['online-payments-config'],
    queryFn: () => onlinePaymentsApi.config().then((r: any) => (r.data ?? r) as OnlineGateway),
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts-for-online-payments'],
    queryFn: () => accountsApi.listAccounts({ limit: 100 }).then((r: any) => ((Array.isArray(r.data) ? r.data : r.data?.data ?? []) as any[]).filter((a) => a.isActive !== false)),
  });
  const { data: recent } = useQuery({
    queryKey: ['online-payments-recent'],
    queryFn: () => onlinePaymentsApi.recent().then((r: any) => ((Array.isArray(r) ? r : r.data) ?? []) as OnlineRecent[]),
    enabled: !!gateway?.connected,
    refetchInterval: 30_000,
  });

  // null = not edited: show what the server has.
  const [keyId, setKeyId] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const shownKeyId = keyId ?? gateway?.keyId ?? '';
  const shownAccount = accountId ?? gateway?.settlementAccount?.id ?? '';
  const shownEnabled = enabled ?? gateway?.enabled ?? false;
  const connected = !!gateway?.connected;
  const dirty = keyId !== null || secret !== '' || accountId !== null || enabled !== null;

  const save = useMutation({
    mutationFn: () => onlinePaymentsApi.save({ keyId: shownKeyId.trim(), keySecret: secret.trim() || undefined, settlementAccountId: shownAccount, enabled: shownEnabled }),
    onSuccess: () => {
      toast.success(connected ? 'Online payments saved' : 'Razorpay connected');
      setKeyId(null); setSecret(''); setAccountId(null); setEnabled(null);
      qc.invalidateQueries({ queryKey: ['online-payments-config'] });
      qc.invalidateQueries({ queryKey: ['online-payments-available'] });
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not save the Razorpay settings')),
  });

  const disconnect = useMutation({
    mutationFn: () => onlinePaymentsApi.disconnect(),
    onSuccess: () => {
      toast.success('Razorpay disconnected');
      setKeyId(null); setSecret(''); setAccountId(null); setEnabled(null);
      qc.invalidateQueries({ queryKey: ['online-payments-config'] });
      qc.invalidateQueries({ queryKey: ['online-payments-available'] });
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not disconnect')),
  });

  if (!gateway) return <p className="text-sm text-slate-500">Loading…</p>;

  const accountOptions = (accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }));
  const ready = shownKeyId.trim() !== '' && shownAccount !== '' && (connected || secret.trim() !== '');

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Let residents pay their bill from the app with UPI, cards or netbanking. The payment goes to <strong>your own Razorpay account</strong> and
        Razorpay pays it into your bank; NG Home never holds your money. When a payment is made the bill is settled automatically, with no approval needed.
      </p>

      {gateway.problem && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{gateway.problem}</p>}

      {connected && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-800">
          <span className="font-mono">{gateway.keyId}</span>
          <span className={gateway.mode === 'LIVE' ? 'rounded-full bg-green-600 px-2 py-0.5 font-semibold text-white' : 'rounded-full bg-amber-500 px-2 py-0.5 font-semibold text-white'}>
            {gateway.mode === 'LIVE' ? 'LIVE: real money' : 'TEST: no real money'}
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Razorpay Key ID" value={shownKeyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_…" autoComplete="off" />
        <Input
          label={connected ? 'Key Secret (leave blank to keep the saved one)' : 'Key Secret'}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={connected ? '••••••••••' : 'Paste the secret shown once in Razorpay'}
          autoComplete="new-password"
        />
      </div>
      <Select
        label="Credit online payments to this account"
        value={shownAccount}
        onChange={(e) => setAccountId(e.target.value)}
        options={accountOptions}
        placeholder="Choose the bank account Razorpay pays into"
      />
      <p className="-mt-2 text-[11px] text-slate-500">
        Razorpay takes its fee before paying you, so your bank may receive slightly less than the amount recorded here. Refunds are made from your Razorpay dashboard.
      </p>

      <div className="flex items-start justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="pr-4">
          <p className="text-sm font-medium text-slate-800">Let residents pay online</p>
          <p className="text-xs text-slate-500">Residents see a &ldquo;Pay online&rdquo; button on their bills. UPI payment with approval keeps working as before.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={shownEnabled}
          aria-label="Let residents pay online"
          onClick={() => setEnabled(!shownEnabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${shownEnabled ? 'bg-primary-600' : 'bg-slate-200'}`}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${shownEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ready || (connected && !dirty)}>
          {connected ? 'Save' : 'Check and connect'}
        </Button>
        {connected && (
          <Button variant="outline" onClick={() => { if (window.confirm('Disconnect Razorpay? Residents will no longer be able to pay online. Payments already made stay recorded.')) disconnect.mutate(); }} loading={disconnect.isPending}>
            Disconnect
          </Button>
        )}
      </div>

      {!connected && (
        <ol className="list-decimal space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-600">
          <li>Open your Razorpay dashboard and go to <strong>Account &amp; Settings → API Keys</strong>.</li>
          <li>Start with <strong>Test mode</strong> keys (rzp_test_…): nothing real is charged while you try it. Switch to Live keys when you are happy.</li>
          <li>Generate a key, copy the <strong>Key ID</strong> and the <strong>Key Secret</strong> (shown only once) and paste them here.</li>
          <li>Payment Links must be available on your Razorpay account; NG Home checks this when you connect.</li>
        </ol>
      )}

      {connected && (recent ?? []).length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Latest online payments</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs">
            {(recent ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate text-slate-700">{o.flatCode ?? 'Flat'} · {formatCurrency(o.amount)} · {new Date(o.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                <span title={o.reason ?? undefined} className={o.outcome === 'PAID' ? 'text-green-700' : o.outcome === 'NEEDS_REVIEW' ? 'font-medium text-amber-700' : o.outcome === 'WAITING' ? 'text-slate-500' : 'text-red-600'}>
                  {OUTCOME_LABEL[o.outcome]}
                </span>
              </li>
            ))}
          </ul>
          {(recent ?? []).some((o) => o.outcome === 'NEEDS_REVIEW') && (
            <p className="mt-1 text-[11px] text-amber-700">&ldquo;Needs your approval&rdquo; payments were received by Razorpay but could not be applied to the bill automatically. Find them in Payments to approve, or refund them from Razorpay.</p>
          )}
        </div>
      )}
    </div>
  );
}
