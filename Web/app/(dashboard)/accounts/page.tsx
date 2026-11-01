'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CheckCircle2, History, Landmark, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { accountsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { PageSpinner, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate } from '@/lib/utils';
import { adjustmentProblem, adjustmentEffect, type AdjustDirection } from '@/lib/adjustments';
import { useAuth } from '@/lib/auth/AuthContext';

const createAccountSchema = z.object({
  name: z.string().min(1, 'Required'),
  accountType: z.enum(['CURRENT', 'SAVINGS', 'CASH', 'FIXED_DEPOSIT', 'OTHER']),
  bankName: z.string().optional(),
  accountNumberMasked: z.string().optional(),
  ifscCode: z.string().optional(),
  openingBalance: z.coerce.number().min(0).optional(),
});
type CreateAccountForm = z.infer<typeof createAccountSchema>;

const createFundSchema = z.object({
  kind: z.enum(['CORPUS', 'OTHER']),
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
  openingBalance: z.coerce.number().min(0).optional(),
  isVisibleToResidents: z.coerce.boolean().optional(),
});
type CreateFundForm = z.infer<typeof createFundSchema>;

export default function AccountsPage() {
  const qc = useQueryClient();
  const { activeMembership } = useAuth();
  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN';
  const [showNewFund, setShowNewFund] = useState(false);
  // Raising or lowering a fund or a bank balance by hand: what is being changed, and the form for it.
  const [adjusting, setAdjusting] = useState<{ kind: 'fund' | 'account'; item: any } | null>(null);
  const [adj, setAdj] = useState({ direction: 'INCREASE' as AdjustDirection, amount: '', comment: '', accountId: '' });
  const [adjError, setAdjError] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<any | null>(null);

  const { data: accountsData, isLoading: loadingAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.listAccounts({ limit: 100 }).then((r: any) => r.data),
  });

  const { data: fundsData, isLoading: loadingFunds } = useQuery({
    queryKey: ['funds'],
    queryFn: () => accountsApi.listFunds({ limit: 100 }).then((r: any) => r.data),
  });

  // The client hands back a plain array for a list with no paging (accounts, funds), and {data, meta} only
  // for a paged one. Reading `.data` off the array found nothing, so these pages always showed no accounts.
  const accounts: any[] = Array.isArray(accountsData) ? accountsData : (accountsData?.data ?? []);
  const funds: any[] = Array.isArray(fundsData) ? fundsData : (fundsData?.data ?? []);

  // Where the money is, worked out on the server so the web and the app always agree: the bank total split into
  // the corpus, every other fund, and what is left (maintenance and general money).
  const { data: money } = useQuery({
    queryKey: ['fund-summary'],
    queryFn: () => accountsApi.fundSummary().then((r: any) => r.data as FundSummary),
  });
  const hasCorpus = funds.some((f: any) => f.kind === 'CORPUS');

  const [showNewAccount, setShowNewAccount] = useState(false);

  const createAccountForm = useForm<CreateAccountForm>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: { accountType: 'CURRENT' },
  });

  const createAccount = useMutation({
    mutationFn: (d: CreateAccountForm) => accountsApi.createAccount(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      toast.success('Account created');
      setShowNewAccount(false);
      createAccountForm.reset({ accountType: 'CURRENT' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create account'),
  });

  const deleteAccount = useMutation({
    mutationFn: (id: string) => accountsApi.deleteAccount(id).then((r: any) => r.data),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      toast.success(
        res?.removedFromLists
          ? `${res.name} is removed from your accounts and totals. Its history is kept.`
          : `${res?.name ?? 'Account'} deleted`,
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not delete the account'),
  });
  const askDeleteAccount = (a: any) => {
    if (
      window.confirm(
        `Delete "${a.name}"?

If nothing has been recorded against it, it is deleted. If payments or expenses have already used it, it is taken off your accounts and totals instead and its history is kept.

You can add the account again with the right balance.`,
      )
    ) {
      deleteAccount.mutate(a.id);
    }
  };

  const createFundForm = useForm<CreateFundForm>({ resolver: zodResolver(createFundSchema), defaultValues: { kind: 'OTHER' } });
  const fundKind = createFundForm.watch('kind');
  const openNewFund = (kind: 'CORPUS' | 'OTHER') => {
    createFundForm.reset({ kind });
    setShowNewFund(true);
  };

  const createFund = useMutation({
    mutationFn: (d: CreateFundForm) => accountsApi.createFund(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      toast.success('Fund created');
      setShowNewFund(false);
      createFundForm.reset({ kind: 'OTHER' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create fund'),
  });

  const openAdjust = (kind: 'fund' | 'account', item: any) => {
    setAdjusting({ kind, item });
    setAdj({ direction: 'INCREASE', amount: '', comment: '', accountId: '' });
    setAdjError(null);
  };
  const closeAdjust = () => { setAdjusting(null); setAdjError(null); };

  const adjust = useMutation({
    mutationFn: () => {
      const body = { direction: adj.direction, amount: Number(adj.amount), comment: adj.comment.trim() };
      return adjusting!.kind === 'fund'
        ? accountsApi.adjustFund(adjusting!.item.id, { ...body, ...(adj.accountId ? { accountId: adj.accountId } : {}) })
        : accountsApi.adjustAccount(adjusting!.item.id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      qc.invalidateQueries({ queryKey: ['fund-history'] });
      toast.success(adjusting?.kind === 'fund' ? 'Fund updated' : 'Balance updated');
      closeAdjust();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      setAdjError(Array.isArray(m) ? m.join(', ') : (m ?? 'Could not save the change'));
    },
  });

  const submitAdjust = () => {
    if (!adjusting) return;
    const problem = adjustmentProblem(adj.amount, adj.comment, adj.direction, Number(adjusting.item.currentBalance));
    if (problem) { setAdjError(problem); return; }
    setAdjError(null);
    adjust.mutate();
  };

  const { data: fundHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['fund-history', historyOf?.id],
    queryFn: () => accountsApi.fundHistory(historyOf.id).then((r: any) => r.data),
    enabled: !!historyOf,
  });

  const totalBalance = accounts.reduce(
    (sum: number, a: any) => sum + Number(a.currentBalance ?? 0),
    0,
  );

  if (loadingAccounts || loadingFunds) return <PageSpinner />;

  return (
    <>
      <Header title="Accounts & Funds" />
      <PageContainer>
        {/* Summary stat */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="p-5">
            <p className="text-xs font-medium text-slate-500">Total Bank Balance</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{formatCurrency(totalBalance)}</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs font-medium text-slate-500">Bank Accounts</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{accounts.length}</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs font-medium text-slate-500">Reserve Funds</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{funds.length}</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs font-medium text-slate-500">Total Fund Balance</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {formatCurrency(
                funds.reduce((s: number, f: any) => s + Number(f.currentBalance ?? 0), 0),
              )}
            </p>
          </Card>
        </div>

        {/* Where the money is: the bank, split so the parts add up to it */}
        {money && <MoneyPicture money={money} />}

        {/* Accounts table */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Bank Accounts
          </h2>
          <Button size="sm" variant="outline" onClick={() => setShowNewAccount(true)}>
            <Plus size={14} /> New Account
          </Button>
        </div>
        {accounts.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No accounts yet"
            description="Add the bank account or cash box your society's money goes into. You need at least one before you can approve any payment."
            action={
              <Button size="sm" onClick={() => setShowNewAccount(true)}>
                <Plus size={14} /> Create Account
              </Button>
            }
          />
        ) : (
          <div className="mb-8 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Bank</Th>
                  <Th>Account No.</Th>
                  <Th className="text-right">Opening Balance</Th>
                  <Th className="text-right">Current Balance</Th>
                  <Th>Status</Th>
                  {isAdmin && <Th className="text-right">Actions</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {accounts.map((a: any) => (
                  <Tr key={a.id}>
                    <Td className="font-medium text-slate-900">{a.name}</Td>
                    <Td>{a.accountType.replace('_', ' ')}</Td>
                    <Td className="text-slate-600">{a.bankName ?? '—'}</Td>
                    <Td className="text-slate-600 font-mono text-xs">{a.accountNumberMasked ?? '—'}</Td>
                    <Td className="text-right text-slate-600">{formatCurrency(a.openingBalance)}</Td>
                    <Td className="text-right font-semibold text-slate-900">{formatCurrency(a.currentBalance)}</Td>
                    <Td>
                      <Badge variant={a.isActive ? 'success' : 'danger'}>
                        {a.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    {isAdmin && (
                      <Td className="text-right">
                        <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Adjust balance of ${a.name}`}
                          onClick={() => openAdjust('account', a)}
                        >
                          <SlidersHorizontal size={14} /> Adjust
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label={`Delete ${a.name}`}
                          loading={deleteAccount.isPending && deleteAccount.variables === a.id}
                          onClick={() => askDeleteAccount(a)}
                        >
                          <Trash2 size={14} /> Delete
                        </Button>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}

        {/* Funds table */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Reserve Funds
          </h2>
          <div className="flex gap-2">
            {!hasCorpus && (
              <Button size="sm" variant="outline" onClick={() => openNewFund('CORPUS')}>
                <Plus size={14} /> Corpus Fund
              </Button>
            )}
            <Button size="sm" onClick={() => openNewFund('OTHER')}>
              <Plus size={14} /> Other Fund
            </Button>
          </div>
        </div>
        {funds.length === 0 ? (
          <p className="text-sm text-slate-500">No funds yet. Add a Corpus Fund, or an Other Fund for a sinking fund, a festival fund or any money you keep apart.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Kind</Th>
                  <Th>Description</Th>
                  <Th className="text-right">Opening Balance</Th>
                  <Th className="text-right">Current Balance</Th>
                  <Th>Visible to Residents</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {funds.map((f: any) => (
                  <Tr key={f.id}>
                    <Td className="font-medium text-slate-900">{f.name}</Td>
                    <Td>
                      <Badge variant={f.kind === 'CORPUS' ? 'info' : 'default'}>{f.kind === 'CORPUS' ? 'Corpus' : 'Other'}</Badge>
                    </Td>
                    <Td className="text-slate-600">{f.description ?? '—'}</Td>
                    <Td className="text-right text-slate-600">{formatCurrency(f.openingBalance)}</Td>
                    <Td className="text-right font-semibold text-slate-900">{formatCurrency(f.currentBalance)}</Td>
                    <Td>
                      <Badge variant={f.isVisibleToResidents ? 'success' : 'default'}>
                        {f.isVisibleToResidents ? 'Yes' : 'No'}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" aria-label={`Add or remove money for ${f.name}`} onClick={() => openAdjust('fund', f)}>
                          <SlidersHorizontal size={14} /> Add / Remove
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`History of ${f.name}`} onClick={() => setHistoryOf(f)}>
                          <History size={14} /> History
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </PageContainer>

      {/* Create account */}
      <Modal
        open={showNewAccount}
        onClose={() => { setShowNewAccount(false); createAccountForm.reset({ accountType: 'CURRENT' }); }}
        title="Create Account"
      >
        <form
          onSubmit={createAccountForm.handleSubmit((d) => createAccount.mutate(d))}
          className="space-y-4"
        >
          <Input
            label="Account Name"
            placeholder="HDFC Current A/c"
            error={createAccountForm.formState.errors.name?.message}
            {...createAccountForm.register('name')}
          />
          <Select
            label="Type"
            options={[
              { value: 'CURRENT', label: 'Current' },
              { value: 'SAVINGS', label: 'Savings' },
              { value: 'CASH', label: 'Cash' },
              { value: 'FIXED_DEPOSIT', label: 'Fixed Deposit' },
              { value: 'OTHER', label: 'Other' },
            ]}
            {...createAccountForm.register('accountType')}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Bank Name" placeholder="HDFC Bank" {...createAccountForm.register('bankName')} />
            <Input label="IFSC Code" placeholder="HDFC0001234" {...createAccountForm.register('ifscCode')} />
          </div>
          <Input
            label="Account Number"
            placeholder="XXXX4321"
            {...createAccountForm.register('accountNumberMasked')}
          />
          <p className="-mt-2 text-xs text-slate-500">
            Last few digits are enough — this is only so people recognise the account.
          </p>
          <Input
            label="Opening Balance (₹)"
            type="number"
            step="0.01"
            placeholder="0"
            error={createAccountForm.formState.errors.openingBalance?.message}
            {...createAccountForm.register('openingBalance')}
          />
          {/* Worth stating plainly: people reasonably assume entering bank
              details connects something. Nothing here talks to a bank. */}
          <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            This is a record for tracking money, not a connection to your bank. The balance
            changes as you approve payments and mark expenses paid.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setShowNewAccount(false); createAccountForm.reset({ accountType: 'CURRENT' }); }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createAccount.isPending}>Create Account</Button>
          </div>
        </form>
      </Modal>

      {/* Create fund */}
      <Modal
        open={showNewFund}
        onClose={() => { setShowNewFund(false); createFundForm.reset({ kind: 'OTHER' }); }}
        title={fundKind === 'CORPUS' ? 'Create Corpus Fund' : 'Create Other Fund'}
      >
        <form
          onSubmit={createFundForm.handleSubmit((d) => createFund.mutate(d))}
          className="space-y-4"
        >
          <Select
            label="Kind of fund"
            options={[
              { value: 'OTHER', label: 'Other fund (sinking, festival, legal, …)' },
              ...(hasCorpus ? [] : [{ value: 'CORPUS', label: 'Corpus fund' }]),
            ]}
            {...createFundForm.register('kind')}
          />
          <Input
            label="Fund Name"
            placeholder={fundKind === 'CORPUS' ? 'Corpus Fund' : 'e.g. Festival Fund, Sinking Fund'}
            error={createFundForm.formState.errors.name?.message}
            {...createFundForm.register('name')}
          />
          <Input
            label="Description"
            placeholder="What this fund is for"
            {...createFundForm.register('description')}
          />
          <Input
            label="Opening Balance (₹)"
            type="number"
            step="0.01"
            placeholder="0"
            error={createFundForm.formState.errors.openingBalance?.message}
            {...createFundForm.register('openingBalance')}
          />
          <p className="-mt-2 text-xs text-slate-500">
            What the fund already holds today. Later changes go through Add / Remove, so they
            leave a ledger entry with your comment. A fund is money set aside inside your bank accounts, not extra
            money: it is taken out of the maintenance and general money shown above.
          </p>
          {/* Unchecked by default: this is the only control over whether
              residents see this fund, so exposure should be a deliberate act
              rather than something that happens because a default was left
              alone. */}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...createFundForm.register('isVisibleToResidents')} />
            Show this fund and its balance to residents
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setShowNewFund(false); createFundForm.reset({ kind: 'OTHER' }); }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createFund.isPending}>Create Fund</Button>
          </div>
        </form>
      </Modal>

      {/* Add or remove money: a fund, or a bank balance, always with a comment */}
      <Modal
        open={!!adjusting}
        onClose={closeAdjust}
        title={adjusting ? (adjusting.kind === 'fund' ? `Add / Remove Money — ${adjusting.item.name}` : `Adjust Balance — ${adjusting.item.name}`) : 'Adjust'}
      >
        {adjusting && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">{adjusting.kind === 'fund' ? 'The fund holds' : 'The account holds'}</p>
              <p className="text-lg font-bold text-slate-900">{formatCurrency(adjusting.item.currentBalance)}</p>
            </div>
            <div role="group" aria-label="Add or remove" className="grid grid-cols-2 gap-2">
              {(['INCREASE', 'DECREASE'] as const).map((d) => {
                const locked = d === 'DECREASE' && !isAdmin;
                const on = adj.direction === d;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={locked}
                    aria-pressed={on}
                    title={locked ? 'Only the admin can take money out' : undefined}
                    onClick={() => { setAdj({ ...adj, direction: d }); setAdjError(null); }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {d === 'INCREASE' ? 'Add money' : 'Remove money'}
                  </button>
                );
              })}
            </div>
            <Input
              label="Amount (₹)"
              type="number"
              step="0.01"
              value={adj.amount}
              onChange={(ev) => setAdj({ ...adj, amount: ev.target.value })}
            />
            <Textarea
              label="Comment: why is this being changed? *"
              placeholder={adjusting.kind === 'fund' ? 'e.g. Donations collected for Ganesh festival' : 'e.g. Interest credited by the bank'}
              value={adj.comment}
              maxLength={500}
              onChange={(ev) => setAdj({ ...adj, comment: ev.target.value })}
            />
            {adjusting.kind === 'fund' && (
              <>
                <Select
                  label={adj.direction === 'INCREASE' ? 'Also add it to a bank account' : 'Also take it from a bank account'}
                  options={[
                    { value: '', label: 'No: the money is already in the accounts' },
                    ...accounts.map((a: any) => ({ value: a.id, label: `${a.name} — ${formatCurrency(a.currentBalance)}` })),
                  ]}
                  value={adj.accountId}
                  onChange={(ev) => setAdj({ ...adj, accountId: ev.target.value })}
                />
                <p className="-mt-2 text-xs text-slate-500">
                  A fund is set aside inside your bank accounts. Pick an account only if money really came into it, or
                  went out of it, now and was not recorded as a payment or an expense. Otherwise leave this as
                  &ldquo;No&rdquo; or the same money is counted twice.
                </p>
              </>
            )}
            {(() => {
              const effect = adjustmentEffect({
                kind: adjusting.kind,
                name: adjusting.item.name,
                direction: adj.direction,
                amount: adj.amount,
                balance: Number(adjusting.item.currentBalance),
                general: money ? Number(money.generalBalance) : null,
                bankMoves: adjusting.kind === 'fund' && !!adj.accountId,
              });
              return effect ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{effect}</p> : null;
            })()}
            {adjError && <p role="alert" className="text-sm text-red-600">{adjError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={closeAdjust}>Cancel</Button>
              <Button onClick={submitAdjust} loading={adjust.isPending}>
                {adjusting.kind === 'account' ? 'Save balance' : adj.direction === 'INCREASE' ? 'Add to fund' : 'Take from fund'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Every entry that has moved a fund, with the comments */}
      <Modal open={!!historyOf} onClose={() => setHistoryOf(null)} title={historyOf ? `History — ${historyOf.name}` : 'History'} size="md">
        {historyOf && (
          <div className="space-y-3">
            {historyLoading ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Opened with {formatCurrency(fundHistory?.fund?.openingBalance ?? historyOf.openingBalance)}; holds{' '}
                  <strong>{formatCurrency(fundHistory?.fund?.currentBalance ?? historyOf.currentBalance)}</strong> now.
                </p>
                {!fundHistory?.entries?.length ? (
                  <p className="text-sm text-slate-500">Nothing has been added or taken out since it was opened.</p>
                ) : (
                  <ul className="space-y-2">
                    {fundHistory.entries.map((e: any) => (
                      <li key={e.id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-900">{e.description}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatDate(e.date)}{e.by ? ` · ${e.by}` : ''}{e.movedBankAccount ? ' · bank account moved too' : ''}
                          </p>
                        </div>
                        <p className={`shrink-0 text-sm font-semibold ${e.direction === 'IN' ? 'text-green-700' : 'text-red-700'}`}>
                          {e.direction === 'IN' ? '+' : '−'}{formatCurrency(e.amount)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

interface FundSummary {
  bankTotal: string;
  accounts: { id: string; name: string; balance: string }[];
  corpus: { total: string; funds: { id: string; name: string; balance: string }[] };
  other: { total: string; funds: { id: string; name: string; balance: string }[] };
  fundsTotal: string;
  generalBalance: string;
  fundsExceedBank: boolean;
  adds: boolean;
}

/**
 * The bank total, split into what each fund holds and what is left, so the parts visibly add up to the bank.
 * A fund is money set aside inside the accounts, so what is left is simply the bank minus the funds; if that
 * goes negative the funds claim more than the bank holds and something needs checking.
 */
function MoneyPicture({ money }: { money: FundSummary }) {
  const Row = ({ label, sub, value, strong }: { label: string; sub?: string; value: string; strong?: boolean }) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className={strong ? 'text-sm font-semibold text-slate-900' : 'text-sm text-slate-700'}>{label}</p>
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
      </div>
      <p className={strong ? 'text-base font-bold text-slate-900' : 'text-sm font-medium text-slate-900'}>{formatCurrency(value)}</p>
    </div>
  );

  return (
    <Card className="mb-8 p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Where the money is</h2>
        {money.fundsExceedBank ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
            <AlertTriangle size={12} /> Funds are more than the bank holds
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
            <CheckCircle2 size={12} /> Adds up to the bank
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        <Row label="In the bank accounts" sub={`${money.accounts.length} active account${money.accounts.length === 1 ? '' : 's'}`} value={money.bankTotal} strong />
        <div className="pl-4">
          <Row
            label="Corpus fund"
            sub={money.corpus.funds.length === 0 ? 'No corpus fund yet' : money.corpus.funds.map((f) => f.name).join(', ')}
            value={money.corpus.total}
          />
          {money.other.funds.length === 0 ? (
            <Row label="Other funds" sub="None yet" value={money.other.total} />
          ) : (
            money.other.funds.map((f) => <Row key={f.id} label={f.name} sub="Other fund" value={f.balance} />)
          )}
          <Row
            label="Maintenance and general money"
            sub="What the bank holds that no fund has set aside"
            value={money.generalBalance}
            strong
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {money.fundsExceedBank
          ? `The funds add up to ${formatCurrency(Math.abs(Number(money.generalBalance)))} more than the bank holds, so this does not reconcile yet. If the bank really holds more, use Adjust on the bank account. If a fund was entered too high, use Add / Remove on that fund. Each change keeps your comment.`
          : 'Corpus fund + other funds + maintenance and general money = what is in the bank. A fund is set aside inside the accounts, so adding to one lowers the general money, not the bank.'}
      </p>
    </Card>
  );
}
