'use client';

/**
 * My electricity: the company and consumer number of my flat's connection, and a reminder on the 8th of every month (or the day
 * chosen) to check and pay the bill. NG Home does not fetch the bill or take payment: the link opens the company's own website.
 * Only the people of this flat can see these numbers.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil, Trash2, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { utilitiesApi } from '@/lib/api/endpoints';
import { DEFAULT_DAY, MAX_CONNECTIONS, OTHER, dateText, isHttps, isValidNumber, ordinal, tidyNumber } from '@/lib/utilities';
import type { UtilityConnection, UtilityProvider } from '@/lib/utilities';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';

const errorText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};

const DAYS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }));

function ConnectionForm({ providers, editing, onDone }: { providers: UtilityProvider[]; editing: UtilityConnection | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(editing?.providerCode ?? '');
  const [otherName, setOtherName] = useState(editing?.providerCode === OTHER ? editing.providerName : '');
  const [otherUrl, setOtherUrl] = useState(editing?.providerCode === OTHER ? editing.providerUrl ?? '' : '');
  const [number, setNumber] = useState(editing?.consumerNumber ?? '');
  const [nickname, setNickname] = useState(editing?.nickname ?? '');
  const [day, setDay] = useState(String(editing?.reminderDay ?? DEFAULT_DAY));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        providerCode: code,
        ...(code === OTHER ? { providerName: otherName.trim(), ...(otherUrl.trim() ? { providerUrl: otherUrl.trim() } : {}) } : {}),
        consumerNumber: tidyNumber(number),
        nickname: nickname.trim(),
        reminderDay: Number(day),
      };
      return editing ? utilitiesApi.update(editing.id, body) : utilitiesApi.create(body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Connection updated' : 'Saved. You will be reminded each month.');
      qc.invalidateQueries({ queryKey: ['my-utilities'] });
      onDone();
    },
    onError: (e: any) => toast.error(errorText(e, 'Could not save')),
  });

  const ok = code !== '' && isValidNumber(number) && (code !== OTHER || otherName.trim() !== '');

  return (
    <Card padding="lg" className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">{editing ? 'Edit connection' : 'Add your connection'}</h3>
      <Select
        label="Electricity company"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        options={[...providers.map((p) => ({ value: p.code, label: p.name })), { value: OTHER, label: 'Other' }]}
        placeholder="Choose your company"
      />
      {code === OTHER && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Company name" value={otherName} onChange={(e) => setOtherName(e.target.value)} maxLength={80} />
          <Input label="Its website to pay on (optional)" value={otherUrl} onChange={(e) => setOtherUrl(e.target.value)} placeholder="https://…" maxLength={300} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Consumer number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="As printed on your bill" maxLength={25} hint="Also called the USC, service connection or consumer no." />
        <Input label="A name for it (optional)" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Flat meter" maxLength={40} />
      </div>
      <Select label="Remind me every month on the" value={day} onChange={(e) => setDay(e.target.value)} options={DAYS} />
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ok}>{editing ? 'Save changes' : 'Save and remind me'}</Button>
        <Button variant="outline" onClick={onDone} disabled={save.isPending}>Cancel</Button>
      </div>
    </Card>
  );
}

export default function ElectricityPage() {
  const qc = useQueryClient();
  const { data: connections, isLoading } = useQuery({
    queryKey: ['my-utilities'],
    queryFn: () => utilitiesApi.mine().then((r: any) => ((Array.isArray(r) ? r : r.data) ?? []) as UtilityConnection[]),
  });
  const { data: providers } = useQuery({
    queryKey: ['utility-providers'],
    queryFn: () => utilitiesApi.providers().then((r: any) => ((r.data ?? r).electricity ?? []) as UtilityProvider[]),
    staleTime: 60 * 60_000,
  });
  const [form, setForm] = useState<'add' | UtilityConnection | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-utilities'] });

  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => utilitiesApi.update(id, { remindersOn: on }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(errorText(e, 'Could not change the reminder')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => utilitiesApi.remove(id),
    onSuccess: () => { toast.success('Removed'); refresh(); },
    onError: (e: any) => toast.error(errorText(e, 'Could not remove it')),
  });

  const list = connections ?? [];

  return (
    <>
      <Header title="Electricity" subtitle="A reminder each month to check and pay your bill" />
      <PageContainer>
        <div className="mx-auto max-w-2xl space-y-4">
          <Card padding="md">
            <p className="flex items-start gap-3 text-sm text-slate-600">
              <Zap size={20} className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
              <span>
                Save your electricity consumer number and NG Home reminds you every month to check and pay the bill. It does not fetch your bill or
                take payment: the link opens your electricity company&apos;s own website. Only people in your flat can see this.
              </span>
            </p>
          </Card>

          {isLoading ? (
            <PageSpinner />
          ) : (
            <>
              {list.length === 0 && form === null && (
                <EmptyState icon={Zap} title="No connection saved yet" description={`You will get a reminder on the ${ordinal(DEFAULT_DAY)} of every month.`} />
              )}

              {list.map((c) => (
                <Card key={c.id} padding="lg" className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-slate-900">{c.nickname || c.providerName}</p>
                      {c.nickname && <p className="truncate text-xs text-slate-500">{c.providerName}</p>}
                      <p className="text-xs text-slate-500">Consumer no. {c.consumerNumber}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setForm(c)} aria-label={`Edit ${c.nickname || c.providerName}`} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil size={15} /></button>
                      <button
                        onClick={() => { if (window.confirm(`Remove ${c.nickname || c.providerName}? You will stop getting its monthly reminder.`)) remove.mutate(c.id); }}
                        aria-label={`Remove ${c.nickname || c.providerName}`}
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-slate-800">Remind me on the {ordinal(c.reminderDay)} of every month</p>
                      <p className="text-xs text-slate-500">{c.remindersOn && c.nextReminder ? `Next reminder: ${dateText(c.nextReminder)}` : 'Reminders are off'}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={c.remindersOn}
                      aria-label={`Monthly reminder for ${c.nickname || c.providerName}`}
                      onClick={() => toggle.mutate({ id: c.id, on: !c.remindersOn })}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${c.remindersOn ? 'bg-primary-600' : 'bg-slate-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${c.remindersOn ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {isHttps(c.providerUrl) ? (
                    <a
                      href={c.providerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                    >
                      <ExternalLink size={15} /> Pay on the company&apos;s website
                    </a>
                  ) : (
                    <p className="text-xs text-slate-500">No website saved for this company. Edit the connection to add one.</p>
                  )}
                </Card>
              ))}

              {form !== null && <ConnectionForm key={form === 'add' ? 'add' : form.id} providers={providers ?? []} editing={form === 'add' ? null : form} onDone={() => setForm(null)} />}

              {form === null && list.length < MAX_CONNECTIONS && (
                <Button variant={list.length === 0 ? 'primary' : 'outline'} onClick={() => setForm('add')}>
                  {list.length === 0 ? 'Add my connection' : 'Add another connection'}
                </Button>
              )}
            </>
          )}
        </div>
      </PageContainer>
    </>
  );
}
