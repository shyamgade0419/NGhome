'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { societyApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

export default function ResidentsPage() {
  const [page] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['residents', page],
    queryFn: () =>
      societyApi.residents({ page, limit: 50 }).then((r: any) => r.data),
  });

  const residents: any[] = data?.data ?? [];

  return (
    <>
      <Header title="Residents" />
      <PageContainer>
        {isLoading ? (
          <PageSpinner />
        ) : residents.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No residents yet"
            description="Residents appear here once they have an active membership."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Flat</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {residents.map((r: any) => (
                  <Tr key={r.id}>
                    <Td className="font-medium text-slate-900">
                      {r.firstName} {r.lastName}
                    </Td>
                    <Td className="text-slate-600">{r.email}</Td>
                    <Td className="text-slate-600">{r.phone ?? 'â€”'}</Td>
                    <Td className="text-slate-600">
                      {r.memberships?.[0]?.flat?.unitNumber ?? 'â€”'}
                    </Td>
                    <Td>
                      <Badge variant="default">
                        {r.memberships?.[0]?.role?.replace(/_/g, ' ') ?? 'â€”'}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge variant={r.isActive ? 'success' : 'danger'}>
                        {r.isActive ? 'Active' : 'Inactive'}
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
