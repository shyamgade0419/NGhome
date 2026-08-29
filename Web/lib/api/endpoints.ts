import { api } from './client';
import type {
  DashboardSummary,
  BillingPeriod,
  MaintenanceBill,
  Payment,
  Expense,
  Announcement,
  PaginatedResponse,
} from '@/lib/types';

// Dashboard — composites several report endpoints
export const dashboardApi = {
  getSummary: async (): Promise<{ data: DashboardSummary }> => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const [collectionRes, accountsRes, pendingRes, statsRes] = await Promise.all([
      api.get('/reports/collection-summary', { params: { year: currentYear, month: currentMonth } }).catch(() => ({ data: null })),
      api.get('/reports/account-balances').catch(() => ({ data: [] })),
      api.get('/payments', { params: { status: 'PENDING', limit: 1 } }).catch(() => ({ data: null })),
      api.get('/societies/my/stats').catch(() => ({ data: null })),
    ]);
    const collection = collectionRes.data;
    const accounts: any[] = accountsRes.data ?? [];
    const pendingPayments = (pendingRes.data as any)?.meta?.total ?? 0;
    const stats = statsRes.data as any;
    const bankAccount = accounts.find((a: any) => a.accountType === 'CURRENT' || a.accountType === 'SAVINGS') ?? accounts[0];
    const corpusAccount = accounts.find((a: any) => a.name?.toLowerCase().includes('corpus'));
    return {
      data: {
        totalBilled: collection?.totalBilled ?? '0',
        totalCollected: collection?.totalCollected ?? '0',
        totalOutstanding: collection?.totalPending ?? '0',
        totalExpenses: '0',
        accountBalance: bankAccount?.currentBalance ?? '0',
        corpusBalance: corpusAccount?.currentBalance ?? '0',
        pendingApprovals: pendingPayments,
        buildings: stats?.buildings ?? 0,
        flats: stats?.flats ?? 0,
        members: stats?.members ?? 0,
      },
    };
  },
};

// Billing periods
export const billingApi = {
  listPeriods: (params?: Record<string, unknown>): Promise<{ data: PaginatedResponse<BillingPeriod> }> =>
    api.get('/billing/periods', { params }),

  getPeriod: (id: string): Promise<{ data: BillingPeriod }> =>
    api.get(`/billing/periods/${id}`),

  createPeriod: (data: unknown): Promise<{ data: BillingPeriod }> =>
    api.post('/billing/periods', data),

  generateBills: (periodId: string): Promise<{ data: { generated: number; errors: number } }> =>
    api.post(`/billing/periods/${periodId}/generate`),

  publishPeriod: (periodId: string): Promise<{ data: BillingPeriod }> =>
    api.post(`/billing/periods/${periodId}/publish`),

  closePeriod: (periodId: string): Promise<{ data: BillingPeriod }> =>
    api.post(`/billing/periods/${periodId}/close`),

  // Bills within a period
  listBills: (periodId: string, params?: Record<string, unknown>): Promise<{ data: PaginatedResponse<MaintenanceBill> }> =>
    api.get(`/billing/periods/${periodId}/bills`, { params }),

  getBill: (billId: string): Promise<{ data: MaintenanceBill }> =>
    api.get(`/billing/bills/${billId}`),
};

// Billing rules
export const billingRulesApi = {
  list: () => api.get('/billing-rules'),
  create: (data: unknown) => api.post('/billing-rules', data),
  update: (id: string, data: unknown) => api.patch(`/billing-rules/${id}`, data),
  toggle: (id: string, isActive: boolean) => api.patch(`/billing-rules/${id}/toggle`, { isActive }),
  delete: (id: string) => api.delete(`/billing-rules/${id}`),
};

// Payments
export const paymentsApi = {
  list: (params?: Record<string, unknown>): Promise<{ data: PaginatedResponse<Payment> }> =>
    api.get('/payments', { params }),

  get: (id: string): Promise<{ data: Payment }> =>
    api.get(`/payments/${id}`),

  // accountId: ID of the society account to credit; fetch via reportsApi.accountBalances() first
  approve: (id: string, accountId: string, notes?: string): Promise<{ data: Payment }> =>
    api.post(`/payments/${id}/approve`, { accountId, notes }),

  reject: (id: string, reason: string): Promise<{ data: Payment }> =>
    api.post(`/payments/${id}/reject`, { reason }),
};

// Expenses
export const expensesApi = {
  list: (params?: Record<string, unknown>): Promise<{ data: PaginatedResponse<Expense> }> =>
    api.get('/expenses', { params }),

  get: (id: string): Promise<{ data: Expense }> =>
    api.get(`/expenses/${id}`),

  create: (data: unknown): Promise<{ data: Expense }> =>
    api.post('/expenses', data),

  update: (id: string, data: unknown): Promise<{ data: Expense }> =>
    api.patch(`/expenses/${id}`, data),

  approve: (id: string) => api.post(`/expenses/${id}/approve`),
  reject: (id: string, reason: string) =>
    api.post(`/expenses/${id}/reject`, { reason }),
};

// Reports
export const reportsApi = {
  outstandingDues: (params?: Record<string, unknown>) =>
    api.get('/reports/outstanding-dues', { params }),

  collectionSummary: (params?: Record<string, unknown>) =>
    api.get('/reports/collection-summary', { params }),

  expenseSummary: (params?: Record<string, unknown>) =>
    api.get('/reports/expense-summary', { params }),

  accountBalances: () => api.get('/reports/account-balances'),
};

// Community
export const communityApi = {
  listAnnouncements: (params?: Record<string, unknown>): Promise<{ data: PaginatedResponse<Announcement> }> =>
    api.get('/announcements', { params }),

  createAnnouncement: (data: unknown): Promise<{ data: Announcement }> =>
    api.post('/announcements', data),

  updateAnnouncement: (id: string, data: unknown): Promise<{ data: Announcement }> =>
    api.patch(`/announcements/${id}`, data),

  deleteAnnouncement: (id: string) =>
    api.delete(`/announcements/${id}`),
};

// Society / admin
export const societyApi = {
  // Returns { user, memberships } from the auth profile endpoint
  memberships: () => api.get('/auth/me'),
  residents: (params?: Record<string, unknown>) => api.get('/users/society', { params }),

  // Society details & config
  getMySociety: () => api.get('/societies/my'),
  updateMySociety: (data: {
    name?: string; displayName?: string; address?: string;
    city?: string; state?: string; pincode?: string; email?: string; phone?: string;
  }) => api.patch('/societies/my', data),
  getConfig: () => api.get('/societies/my/config'),
  updateConfig: (data: {
    currency?: string; billingCycle?: string; billingDueDay?: number;
    financialYearStartMonth?: number; gracePeriodDays?: number;
    lateFeeType?: string; lateFeeValue?: number; lateFeeMaxAmount?: number;
    invoicePrefix?: string; paymentVerificationRequired?: boolean;
    allowPaymentProofUpload?: boolean; showCorpusToResidents?: boolean;
    showFundBalancesToResidents?: boolean; showExpensesToResidents?: boolean;
    publishStatementToResidents?: boolean; publishMeetingMinutes?: boolean;
  }) => api.patch('/societies/my/config', data),

  // Buildings
  buildings: (params?: Record<string, unknown>) => api.get('/buildings', { params }),
  createBuilding: (data: { name: string; code?: string; description?: string; totalFloors?: number }) =>
    api.post('/buildings', data),
  updateBuilding: (id: string, data: unknown) => api.patch(`/buildings/${id}`, data),
  deleteBuilding: (id: string) => api.delete(`/buildings/${id}`),

  // Flats
  flats: (params?: Record<string, unknown>) => api.get('/flats', { params }),
  createFlat: (data: {
    buildingId: string;
    unitNumber: string;
    flatCode: string;
    floorId?: string;
    area?: number;
    bedrooms?: number;
    bathrooms?: number;
    category?: string;
    status?: string;
    ownershipType?: string;
    parkingSlots?: number;
  }) => api.post('/flats', data),
  updateFlat: (id: string, data: unknown) => api.patch(`/flats/${id}`, data),
  deleteFlat: (id: string) => api.delete(`/flats/${id}`),

  stats: () => api.get('/societies/my/stats'),
};

// Accounts & Funds
export const accountsApi = {
  listAccounts: (params?: Record<string, unknown>) => api.get('/accounts', { params }),
  getAccount: (id: string) => api.get(`/accounts/${id}`),
  listFunds: (params?: Record<string, unknown>) => api.get('/funds', { params }),
  getTransactions: (accountId: string, params?: Record<string, unknown>) =>
    api.get(`/accounts/${accountId}/transactions`, { params }),
};
