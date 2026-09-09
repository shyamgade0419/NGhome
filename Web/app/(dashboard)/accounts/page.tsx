'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Landmark, Plus } from 'lucide-react';
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
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency } from '@/lib/utils';

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
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
  openingBalance: z.coerce.number().min(0).optional(),
  isVisibleToResidents: z.coerce.boolean().optional(),
});
type CreateFundForm = z.infer<typeof createFundSchema>;

const contributeSchema = z.object({
  amount: z.coerce.number().positive('Enter an amount greater than zero'),
  description: z.string().optional(),
  // '' means "don't credit any bank account" — see the note in the modal.
  accountId: z.string().optional(),
});
type ContributeForm = z.infer<typeof contributeSchema>;

export default function AccountsPage() {
  const qc = useQueryClient();
  const [showNewFund, setShowNewFund] = useState(false);
  const [contributeTo, setContributeTo] = useState<any | null>(null);

  const { data: accountsData, isLoading: loadingAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.listAccounts({ limit: 100 }).then((r: any) => r.data),
  });

  const { data: fundsData, isLoading: loadingFunds } = useQuery({
    queryKey: ['funds'],
    queryFn: () => accountsApi.listFunds({ limit: 100 }).then((r: any) => r.data),
  });

  const accounts: any[] = accountsData?.data ?? [];
  const funds: any[] = fundsData?.data ?? [];

  const [showNewAccount, setShowNewAccount] = useState(false);

  const createAccountForm = useForm<CreateAccountForm>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: { accountType: 'CURRENT' },
  });

  const createAccount = useMutation({
    mutationFn: (d: CreateAccountForm) => accountsApi.createAccount(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account created');
      setShowNewAccount(false);
      createAccountForm.reset({ accountType: 'CURRENT' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create account'),
  });

  const createFundForm = useForm<CreateFundForm>({ resolver: zodResolver(createFundSchema) });
  const contributeForm = useForm<ContributeForm>({ resolver: zodResolver(contributeSchema) });

  const createFund = useMutation({
    mutationFn: (d: CreateFundForm) => accountsApi.createFund(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funds'] });
      toast.success('Fund created');
      setShowNewFund(false);
      createFundForm.reset();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create fund'),
  });

  const contribute = useMutation({
    mutationFn: (d: ContributeForm) =>
      accountsApi.contributeToFund(contributeTo.id, {
        amount: d.amount,
        description: d.description || undefined,
        accountId: d.accountId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Added to fund');
      setContributeTo(null);
      contributeForm.reset();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add to fund'),
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
          <Button size="sm" onClick={() => setShowNewFund(true)}>
            <Plus size={14} /> New Fund
          </Button>
        </div>
        {funds.length === 0 ? (
          <p className="text-sm text-slate-500">No reserve funds configured.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
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
                    <Td className="text-slate-600">{f.description ?? '—'}</Td>
                    <Td className="text-right text-slate-600">{formatCurrency(f.openingBalance)}</Td>
                    <Td className="text-right font-semibold text-slate-900">{formatCurrency(f.currentBalance)}</Td>
                    <Td>
                      <Badge variant={f.isVisibleToResidents ? 'success' : 'default'}>
                        {f.isVisibleToResidents ? 'Yes' : 'No'}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setContributeTo(f)}>
                        Add Money
                      </Button>
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
        onClose={() => { setShowNewFund(false); createFundForm.reset(); }}
        title="Create Fund"
      >
        <form
          onSubmit={createFundForm.handleSubmit((d) => createFund.mutate(d))}
          className="space-y-4"
        >
          <Input
            label="Fund Name"
            placeholder="Corpus Fund"
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
            What the fund already holds today. Later additions go through Add Money, so they
            leave a ledger entry.
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
              onClick={() => { setShowNewFund(false); createFundForm.reset(); }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createFund.isPending}>Create Fund</Button>
          </div>
        </form>
      </Modal>

      {/* Add money to fund */}
      <Modal
        open={!!contributeTo}
        onClose={() => { setContributeTo(null); contributeForm.reset(); }}
        title={contributeTo ? `Add Money — ${contributeTo.name}` : 'Add Money'}
      >
        <form
          onSubmit={contributeForm.handleSubmit((d) => contribute.mutate(d))}
          className="space-y-4"
        >
          <Input
            label="Amount (₹)"
            type="number"
            step="0.01"
            error={contributeForm.formState.errors.amount?.message}
            {...contributeForm.register('amount')}
          />
          <Input
            label="What is this?"
            placeholder="e.g. Corpus collection Q3"
            {...contributeForm.register('description')}
          />
          <Select
            label="Also credit a bank account"
            options={[
              { value: '', label: 'No — money is already in the accounts' },
              ...accounts.map((a: any) => ({ value: a.id, label: a.name })),
            ]}
            {...contributeForm.register('accountId')}
          />
          {/* A fund is an earmark inside an account, not a second pot of money.
              Crediting an account for a payment that was already approved would
              count the same rupee twice, so this defaults to "no". */}
          <p className="-mt-2 text-xs text-slate-500">
            Pick an account only if this money is arriving now and was never recorded as a
            payment — a cash collection, say. If it came in through the app, leave this as
            &ldquo;No&rdquo; or it will be counted twice.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setContributeTo(null); contributeForm.reset(); }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={contribute.isPending}>Add to Fund</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
