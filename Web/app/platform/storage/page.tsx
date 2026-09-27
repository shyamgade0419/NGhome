'use client';

/**
 * File storage: how much each society has uploaded (documents, payment proofs
 * and screenshots — all kept on the SFTP server, in a folder per society), and
 * a button to test that the server is reachable and writable.
 *
 * Sizes come from the database records, so opening this page is cheap. The
 * connection test opens a real SFTP connection and is only ever run from the
 * button, never on load.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Files, HardDrive, Plug, XCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { platformApi, PlatformStorageCheck } from '@/lib/api/endpoints';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Card, DButton, DTable, Empty, Loading, PageHeader, StatTile, TableWrap, Td, formatBytes } from '@/components/platform/ui';

const TYPE_LABELS: Record<string, string> = {
  images: 'Images & screenshots',
  pdf: 'PDFs',
  office: 'Office & CSV',
  other: 'Other',
};

export default function PlatformStoragePage() {
  const { user } = useAuth();
  const [check, setCheck] = useState<PlatformStorageCheck | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-storage'],
    queryFn: () => platformApi.storage().then((r) => r.data),
    enabled: !!user?.isPlatformAdmin,
  });

  const test = useMutation({
    mutationFn: () => platformApi.checkStorage().then((r) => r.data),
    onSuccess: setCheck,
    onError: (e: any) =>
      setCheck({ ok: false, reason: e?.response?.data?.message ?? 'The check could not run (too many attempts, or the API is unreachable).' }),
  });

  const largest = data?.societies[0];

  return (
    <PlatformShell>
      <PageHeader title="Storage" subtitle="Uploaded files across all societies" />

      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <Empty icon={HardDrive} title="Couldn't load storage usage" description="Try refreshing the page." />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Total used" value={formatBytes(data.totalBytes)} icon={HardDrive} hint="Across all live societies" />
            <StatTile label="Files" value={data.totalFiles} icon={Files} tone="blue" />
            <StatTile
              label="Largest society"
              value={largest && largest.bytes > 0 ? largest.name : '—'}
              hint={largest && largest.bytes > 0 ? formatBytes(largest.bytes) : 'No files yet'}
              tone="violet"
            />
            <StatTile
              label="Avg per society"
              value={data.societies.length ? formatBytes(Math.round(data.totalBytes / data.societies.length)) : '—'}
              tone="amber"
            />
          </div>

          <Card
            title="Storage server"
            icon={Plug}
            action={
              <DButton size="sm" variant="primary" loading={test.isPending} onClick={() => test.mutate()}>
                Test connection
              </DButton>
            }
          >
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-400">Provider</dt>
                <dd className="font-medium text-white">{data.provider.toUpperCase()}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-400">Base folder</dt>
                <dd className="font-mono text-gray-100">{data.basePath}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-gray-500">
              Each society&apos;s files live in their own folder under the base folder. The test connects, writes a small
              file and deletes it, so it proves uploads will work.
            </p>

            {check && (
              <div
                role="status"
                className={
                  check.ok
                    ? 'mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200'
                    : 'mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200'
                }
              >
                {check.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
                <div>
                  {check.ok ? (
                    <>
                      <p className="font-medium">Connected and writable</p>
                      <p className="text-xs opacity-80">Writing under {check.base} (account home: {check.home})</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Storage check failed</p>
                      <p className="text-xs opacity-90">{check.reason}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="By file type">
              <ul className="space-y-3">
                {Object.entries(data.byType).map(([kind, v]) => {
                  const pct = data.totalBytes > 0 ? Math.round((v.bytes / data.totalBytes) * 100) : 0;
                  return (
                    <li key={kind}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-gray-300">{TYPE_LABELS[kind] ?? kind}</span>
                        <span className="tabular-nums text-gray-400">
                          {v.files} · {formatBytes(v.bytes)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                        <div className="h-full rounded-full bg-teal-400" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <div className="lg:col-span-2">
              {data.societies.length === 0 ? (
                <Empty icon={HardDrive} title="No societies yet" />
              ) : (
                <TableWrap>
                  <DTable head={['Society', 'Files', 'Size', 'Share']}>
                    {data.societies.map((s) => {
                      const pct = data.totalBytes > 0 ? Math.round((s.bytes / data.totalBytes) * 100) : 0;
                      return (
                        <tr key={s.societyId} className="hover:bg-gray-800/30">
                          <Td className="font-medium text-white">{s.name}</Td>
                          <Td className="tabular-nums">{s.files}</Td>
                          <Td className="tabular-nums">{formatBytes(s.bytes)}</Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-800">
                                <div className="h-full rounded-full bg-teal-400" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs tabular-nums text-gray-400">{pct}%</span>
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </DTable>
                </TableWrap>
              )}
            </div>
          </div>
        </div>
      )}
    </PlatformShell>
  );
}
