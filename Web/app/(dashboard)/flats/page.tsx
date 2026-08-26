'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Home } from 'lucide-react';
import { societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success',
  VACANT: 'warning',
  UNDER_RENOVATION: 'default',
  INACTIVE: 'danger',
};

export default function FlatsPage() {
  const [page] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['flats', page],
    queryFn: () =>
      societyApi.flats({ page, limit: 100 }).then((r: any) => r.data),
  });

  const flats: any[] = data?.data ?? [];

  return (
    <>
      <Header title="Flats" />
      <PageContainer>
        {isLoading ? (
          <PageSpinner />
        ) : flats.length === 0 ? (
          <EmptyState
            icon={Home}
            title="No flats yet"
            description="Add buildings and flats via the Settings page."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <Table>
              <Thead>
                <Tr>
                  <Th>Flat Code</Th>
                  <Th>Unit</Th>
                  <Th>Building</Th>
                  <Th>Area (sq ft)</Th>
                  <Th>Bedrooms</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {flats.map((f: any) => (
                  <Tr key={f.id}>
                    <Td className="font-medium text-slate-900">{f.flatCode}</Td>
                    <Td>{f.unitNumber}</Td>
                    <Td className="text-slate-600">{f.building?.name ?? 'â€”'}</Td>
                    <Td className="text-slate-600">{f.area ? Number(f.area).toLocaleString('en-IN') : 'â€”'}</Td>
                    <Td className="text-slate-600">{f.bedrooms ?? 'â€”'}</Td>
                    <Td className="text-slate-600">{f.category ?? 'â€”'}</Td>
                    <Td>
                      <Badge variant={statusVariant[f.status] ?? 'default'}>
                        {f.status}
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
