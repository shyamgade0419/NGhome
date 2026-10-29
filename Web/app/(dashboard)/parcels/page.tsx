'use client';

/**
 * Committee: the parcel log. Which parcels the gate received, for which flat,
 * who recorded them and how each ended (collected or sent back). Parcels still
 * at the gate come first in the count at the top; one left for days is marked,
 * because it usually means a resident was never reached. Recording and handing
 * over happen at the gate, in the mobile app, so this page only reads.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Search } from 'lucide-react';
import { parcelsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { fmtDayOf, fmtTime } from '@/lib/amenities';
import { PARCEL_STATUS, PARCEL_STATUS_OPTIONS, heldFor, isStale, type ParcelStatus } from '@/lib/parcels';

export default function ParcelsPage() {
  const [status, setStatus] = useState<'' | ParcelStatus>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const filters = { status: status || undefined, search: search.trim() || undefined, from: from || undefined, to: to || undefined };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['parcel-log', filters, page],
    queryFn: () => parcelsApi.log({ ...filters, page, limit: 25 }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  // How many are still at the gate, whatever the other filters say.
  const { data: held } = useQuery({
    queryKey: ['parcel-log-held'],
    queryFn: () => parcelsApi.log({ status: 'RECEIVED', limit: 1 }).then((r) => r.data.meta.total),
    refetchInterval: 30_000,
  });

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const anyFilter = !!(status || search || from || to);

  return (
    <>
      <Header title="Parcels" subtitle={held ? `${held} at the gate` : 'Parcel log'} />
      <PageContainer className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_9rem_9rem_auto]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => reset(setSearch)(e.target.value)}
              placeholder="Courier, name on the parcel or flat"
              aria-label="Search parcels"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <Select aria-label="Status" options={PARCEL_STATUS_OPTIONS} value={status} onChange={(e) => reset(setStatus)(e.target.value as '' | ParcelStatus)} />
          <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
          <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setStatus(''); setSearch(''); setFrom(''); setTo(''); setPage(1); }}>
              Clear
            </Button>
          )}
        </div>

        <Card padding="none">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : isError ? (
            <EmptyState icon={Package} title="Could not load the parcel log" description="Check your connection and refresh the page." />
          ) : !data?.data.length ? (
            <EmptyState
              icon={Package}
              title={anyFilter ? 'No parcels match' : 'No parcels yet'}
              description={anyFilter ? 'Try different filters.' : 'Parcels appear here once a guard records one at the gate.'}
            />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Arrived (IST)</Th>
                  <Th>Parcel</Th>
                  <Th>Flat</Th>
                  <Th>Status</Th>
                  <Th>Handled by</Th>
                </Tr>
              </Thead>
              <Tbody>
                {data.data.map((p) => {
                  const s = PARCEL_STATUS[p.status];
                  return (
                    <Tr key={p.id}>
                      <Td className="whitespace-nowrap">
                        <div className="font-medium text-slate-900">{fmtDayOf(p.receivedAt)}</div>
                        <div className="text-xs text-slate-500">
                          {fmtTime(p.receivedAt)}
                          {p.closedAt ? ` · closed ${fmtTime(p.closedAt)}` : ''}
                        </div>
                      </Td>
                      <Td>
                        <div className="font-medium text-slate-900">{p.courier}</div>
                        <div className="text-xs text-slate-500">
                          {[p.recipientName && `For ${p.recipientName}`, p.note].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td className="font-medium">{p.flatCode ?? '—'}</Td>
                      <Td>
                        <Badge variant={s.variant}>{s.label}</Badge>
                        {p.status === 'RECEIVED' && (
                          <div className={`mt-1 text-xs ${isStale(p) ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                            Here for {heldFor(p.receivedAt)}
                            {isStale(p) ? ' — has the resident been reached?' : ''}
                          </div>
                        )}
                        {p.status === 'COLLECTED' && p.collectedByName && <div className="mt-1 text-xs text-slate-500">Taken by {p.collectedByName}</div>}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {p.receivedBy && <div>Recorded: {p.receivedBy}</div>}
                        {p.closedBy && <div>{p.status === 'RETURNED' ? 'Sent back' : 'Handed over'}: {p.closedBy}</div>}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </Card>

        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{data.meta.total} parcels</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </PageContainer>
    </>
  );
}
