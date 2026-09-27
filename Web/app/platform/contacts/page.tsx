'use client';

/**
 * Who to call: every society's admin contacts in one list, filterable and
 * exportable. Built from the same society list the Societies page uses — no
 * extra endpoint.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookUser, Download, Mail, Phone, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { DButton, DTable, Empty, Loading, PageHeader, Pill, TableWrap, Td } from '@/components/platform/ui';
import { downloadCsv, toCsv } from '@/lib/csv';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'active' | 'suspended';

interface ContactRow {
  key: string;
  societyId: string;
  society: string;
  isActive: boolean;
  name: string;
  email: string;
  phone: string;
}

export default function PlatformContactsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-societies'],
    queryFn: () => platformApi.listSocieties({ limit: 100 }).then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  const rows: ContactRow[] = useMemo(
    () =>
      (data?.data ?? []).flatMap((s) =>
        s.admins.map((a) => ({
          key: `${s.id}-${a.id}`,
          societyId: s.id,
          society: s.displayName ?? s.name,
          isActive: s.isActive,
          name: `${a.firstName} ${a.lastName}`,
          email: a.email,
          phone: a.phone ?? '',
        })),
      ),
    [data],
  );
  const withoutAdmin = (data?.data ?? []).filter((s) => s.admins.length === 0).length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'active' && !r.isActive) return false;
      if (filter === 'suspended' && r.isActive) return false;
      return !term || [r.name, r.email, r.phone, r.society].some((v) => v.toLowerCase().includes(term));
    });
  }, [rows, filter, search]);

  const exportCsv = () => {
    const csv = toCsv(
      ['Society', 'Status', 'Admin name', 'Email', 'Phone'],
      visible.map((r) => [r.society, r.isActive ? 'Active' : 'Suspended', r.name, r.email, r.phone]),
    );
    downloadCsv(`nghome-contacts-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'suspended', label: 'Suspended' },
  ];

  return (
    <PlatformShell>
      <PageHeader
        title="Contacts"
        subtitle="Society admin details for support and announcements"
        actions={
          <DButton variant="primary" onClick={exportCsv} disabled={visible.length === 0}>
            <Download size={15} /> Export CSV ({visible.length})
          </DButton>
        }
      />

      {data && (
        <p className="mb-4 text-sm text-gray-400">
          {rows.length} contact{rows.length === 1 ? '' : 's'} · {rows.filter((r) => r.phone).length} with a phone number
          {withoutAdmin > 0 && ` · ${withoutAdmin} societ${withoutAdmin === 1 ? 'y' : 'ies'} with no admin`}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5" role="group" aria-label="Filter by status">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              aria-pressed={filter === c.key}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                filter === c.key
                  ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-800',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -trangray-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone or society"
            aria-label="Search contacts"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <Empty icon={BookUser} title="Couldn't load contacts" description="Try refreshing the page." />
      ) : visible.length === 0 ? (
        <Empty icon={BookUser} title="No contacts found" description="Try another filter or search term." />
      ) : (
        <TableWrap>
          <DTable head={['Admin', 'Society', 'Phone', 'Status']}>
            {visible.map((r) => (
              <tr key={r.key} className="hover:bg-gray-800/30">
                <Td>
                  <p className="font-medium text-white">{r.name}</p>
                  <p className="flex items-center gap-1 text-xs text-gray-400"><Mail size={11} /> {r.email}</p>
                </Td>
                <Td>
                  <Link href={`/platform/${r.societyId}`} className="text-gray-100 hover:text-teal-300 hover:underline">
                    {r.society}
                  </Link>
                </Td>
                <Td>
                  {r.phone ? (
                    <span className="flex items-center gap-1 text-gray-200"><Phone size={12} /> {r.phone}</span>
                  ) : (
                    <span className="text-xs text-gray-500">No phone</span>
                  )}
                </Td>
                <Td>
                  <Pill tone={r.isActive ? 'green' : 'red'}>{r.isActive ? 'Active' : 'Suspended'}</Pill>
                </Td>
              </tr>
            ))}
          </DTable>
        </TableWrap>
      )}
    </PlatformShell>
  );
}
