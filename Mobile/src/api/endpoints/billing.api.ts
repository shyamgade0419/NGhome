import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';
import { BillingPeriod, MaintenanceBill } from '@/types/billing.types';

export const billingApi = {
  // ─── Admin: billing periods ────────────────────────────────────────────────

  getBillingPeriods: async (query?: PaginationQuery & { status?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<BillingPeriod>>(
      '/billing/periods',
      { params: query },
    );
    return data;
  },

  // Returns the most recent non-closed billing period.
  getCurrentPeriod: async (): Promise<BillingPeriod | null> => {
    const { data } = await apiClient.get<PaginatedResponse<BillingPeriod>>(
      '/billing/periods',
      { params: { limit: 1, page: 1 } },
    );
    const periods = data.data ?? [];
    return periods.find((p) => p.status !== 'CLOSED') ?? periods[0] ?? null;
  },

  getBillingPeriod: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<BillingPeriod>>(`/billing/periods/${id}`);
    return data.data;
  },

  createBillingPeriod: async (payload: {
    periodYear: number;
    periodMonth: number;
    startDate: string;
    endDate: string;
    dueDate: string;
    notes?: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<BillingPeriod>>('/billing/periods', payload);
    return data.data;
  },

  generateBills: async (periodId: string) => {
    const { data } = await apiClient.post<ApiResponse<{ generated: number; errors: number }>>(
      `/billing/periods/${periodId}/generate`,
    );
    return data.data;
  },

  publishPeriod: async (periodId: string) => {
    const { data } = await apiClient.post<ApiResponse<BillingPeriod>>(
      `/billing/periods/${periodId}/publish`,
    );
    return data.data;
  },

  getBillsForPeriod: async (periodId: string, query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<MaintenanceBill>>(
      `/billing/periods/${periodId}/bills`,
      { params: query },
    );
    return data;
  },

  getBill: async (billId: string) => {
    const { data } = await apiClient.get<ApiResponse<MaintenanceBill>>(`/billing/bills/${billId}`);
    return data.data;
  },

  // ─── Admin: dashboard summary ──────────────────────────────────────────────

  getDashboardSummary: async () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const [collectionRes, accountsRes, pendingRes] = await Promise.all([
      apiClient
        .get<ApiResponse<{
          totalBilled: string;
          totalCollected: string;
          totalPending: string;
          collectionRate: string;
        }>>('/reports/collection-summary', {
          params: { year: currentYear, month: currentMonth },
        })
        .catch(() => null),
      apiClient
        .get<ApiResponse<Array<{ id: string; name: string; accountType: string; currentBalance: string }>>>(
          '/reports/account-balances',
        )
        .catch(() => null),
      apiClient
        .get<PaginatedResponse<{ id: string }>>('/payments', {
          params: { status: 'PENDING', limit: 1 },
        })
        .catch(() => null),
    ]);

    const collection = collectionRes?.data?.data;
    const accounts = accountsRes?.data?.data ?? [];
    const pendingApprovals = pendingRes?.data?.meta?.total ?? 0;

    const bankAccount =
      accounts.find((a) => a.accountType === 'CURRENT' || a.accountType === 'SAVINGS') ??
      accounts[0];
    const corpusAccount = accounts.find((a) =>
      a.name?.toLowerCase().includes('corpus'),
    );

    return {
      totalBilled: collection?.totalBilled ?? '0',
      totalCollected: collection?.totalCollected ?? '0',
      totalOutstanding: collection?.totalPending ?? '0',
      totalExpenses: '0',
      accountBalance: bankAccount?.currentBalance ?? '0',
      corpusBalance: corpusAccount?.currentBalance ?? '0',
      pendingApprovals,
    };
  },

  // ─── Resident: my bills ────────────────────────────────────────────────────

  getMyBills: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<MaintenanceBill>>(
      '/billing/my-bills',
      { params: query },
    );
    return data;
  },

  // Returns the most recent unpaid published bill for the resident.
  getMyCurrentBill: async (): Promise<MaintenanceBill | null> => {
    const { data } = await apiClient.get<PaginatedResponse<MaintenanceBill>>(
      '/billing/my-bills',
      { params: { limit: 5, page: 1 } },
    );
    const bills = data.data ?? [];
    return bills.find((b) => b.isPublished && !b.isPaid) ?? bills[0] ?? null;
  },

  getMyBill: async (billId: string) => {
    const { data } = await apiClient.get<ApiResponse<MaintenanceBill>>(
      `/billing/my-bills/${billId}`,
    );
    return data.data;
  },
};
