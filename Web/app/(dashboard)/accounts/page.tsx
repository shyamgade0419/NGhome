'use client';

import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { accountsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency } from '@/lib/utils';

export default function AccountsPage() {
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
        <h2 className="mb-3 text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Bank Accounts
        </h2>
        {accounts.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No accounts yet"
            description="Add bank accounts in Settings to start tracking balances."
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
        <h2 className="mb-3 text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Reserve Funds
        </h2>
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
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </PageContainer>
    </>
  );
}
