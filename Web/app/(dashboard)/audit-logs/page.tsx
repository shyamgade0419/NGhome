'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Filter } from 'lucide-react';
import { auditLogsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime } from '@/lib/utils';

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'CREATE', label: 'Create' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'APPROVE', label: 'Approve' },
  { value: 'REJECT', label: 'Reject' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'EXPORT', label: 'Export' },
];

function actionBadge(action: string) {
  const v = (() => {
    if (['CREATE'].includes(action)) return 'success';
    if (['UPDATE', 'APPROVE'].includes(action)) return 'info';
    if (['DELETE', 'REJECT'].includes(action)) return 'danger';
    return 'default';
  })();
  return <Badge variant={v as any}>{action}</Badge>;
}

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', action, entityType, fromDate, toDate, page],
    queryFn: () => auditLogsApi.list({
      page,
      limit: 50,
      action: action || undefined,
      entityType: entityType || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }).then((r: any) => r.data ?? r),
  });

  const logs: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  const meta = data?.meta;

  return (
    <>
      <Header title="Audit Logs" />
      <PageContainer>
        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Select
            label=""
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            options={ACTION_OPTIONS}
            className="w-40"
          />
          <Input
            label=""
            placeholder="Entity type (e.g. PAYMENT)"
            value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
            className="w-48"
          />
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </div>
          </div>
          {(action || entityType || fromDate || toDate) && (
            <button
              onClick={() => { setAction(''); setEntityType(''); setFromDate(''); setToDate(''); setPage(1); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
            >
              Clear filters
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No audit logs"
            description="System actions will appear here as they happen."
          />
        ) : (
          <>
            <Table>
              <Thead>
                <Tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Details</Th>
                </Tr>
              </Thead>
              <Tbody>
                {logs.map((log: any) => (
                  <Tr key={log.id}>
                    <Td>
                      <span className="whitespace-nowrap text-sm text-slate-500">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{log.actor?.displayName ?? log.actorId ?? '—'}</p>
                        <p className="text-xs text-slate-400">{log.actor?.email}</p>
                      </div>
                    </Td>
                    <Td>{actionBadge(log.action)}</Td>
                    <Td>
                      <div>
                        <p className="text-sm text-slate-700">{log.entityType ?? '—'}</p>
                        {log.entityId && <p className="text-xs text-slate-400 font-mono">{log.entityId.slice(0, 8)}…</p>}
                      </div>
                    </Td>
                    <Td>
                      {log.description && (
                        <p className="max-w-xs truncate text-sm text-slate-600" title={log.description}>
                          {log.description}
                        </p>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                <span>Page {meta.page} of {meta.totalPages} ({meta.total} total)</span>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
                  >
                    ← Prev
                  </button>
                  <button
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </PageContainer>
    </>
  );
}
