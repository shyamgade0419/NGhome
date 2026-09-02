import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';
import { BillingPeriod, MaintenanceBill } from '@/types/billing.types';

export const billingApi = {
  // ─── Admin: billing periods ────────────────────────────────────────────────

  // Admin/Accountant only — 403s for residents. Use listPublishedPeriods() below
  // for any screen a resident can reach.
  getBillingPeriods: async (query?: PaginationQuery & { status?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<BillingPeriod>>(
      '/billing/periods',
      { params: query },
    );
    return data;
  },

  // Resident-safe: only ever returns PUBLISHED periods, no role guard.
  listPublishedPeriods: async (): Promise<BillingPeriod[]> => {
    const { data } = await apiClient.get<ApiResponse<BillingPeriod[]>>('/billing/periods/published');
    return data.data ?? [];
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

  closePeriod: async (periodId: string) => {
    const { data } = await apiClient.post<ApiResponse<BillingPeriod>>(
      `/billing/periods/${periodId}/close`,
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

  /**
   * Admin/Accountant only, and only while the bill's period is DRAFT,
   * CALCULATED, REVIEW or PARTIALLY_PAID — the backend 403s on
   * CLOSED/PUBLISHED/PAID. Negative amount = discount, positive = surcharge.
   * `note` REPLACES the bill's notes field entirely (confirmed from source —
   * it's `notes: note`, not an append), so the caller must pre-fill it with
   * the bill's current notes to avoid silently destroying context set via
   * the separate per-flat notes editor on the Maintenance Sheet, which
   * writes the same column.
   */
  adjustBill: async (billId: string, amount: number, note: string) => {
    const { data } = await apiClient.patch<ApiResponse<MaintenanceBill>>(
      `/billing/bills/${billId}/adjust`,
      { adjustment: amount, note },
    );
    return data.data;
  },

  // ─── Admin: dashboard summary ──────────────────────────────────────────────

  getDashboardSummary: async () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const monthStart = new Date(currentYear, currentMonth - 1, 1).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const [collectionRes, accountsRes, pendingRes, expenseRes] = await Promise.all([
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
      // totalExpenses used to be hardcoded to '0' here — the tile always
      // read zero regardless of real spending. expense-summary already
      // exists and is exactly this month-to-date total.
      apiClient
        .get<ApiResponse<{ byCategory: Array<{ category: string; total: number }>; total: number }>>(
          '/reports/expense-summary',
          { params: { fromDate: monthStart, toDate: today } },
        )
        .catch(() => null),
    ]);

    const collection = collectionRes?.data?.data;
    const accounts = accountsRes?.data?.data ?? [];
    const pendingApprovals = pendingRes?.data?.meta?.total ?? 0;
    const totalExpenses = expenseRes?.data?.data?.total ?? 0;

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
      totalExpenses: String(totalExpenses),
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

  /**
   * Resident: preview the flat's bill for a period that's been calculated
   * but not yet published. Returns null when there's nothing to preview
   * (no CALCULATED/REVIEW period, or the resident has no flat).
   */
  previewMyBill: async (): Promise<(MaintenanceBill & { periodStatus: string; isPreview: true }) | null> => {
    const { data } = await apiClient.get<ApiResponse<(MaintenanceBill & { periodStatus: string; isPreview: true }) | null>>(
      '/billing/my-bills/preview',
    );
    return data.data ?? null;
  },
};
