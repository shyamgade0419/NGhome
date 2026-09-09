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

  // Full period report for PDF / holistic view (admin)
  getPeriodReport: (periodId: string) => api.get(`/billing/periods/${periodId}/report`),

  // Comprehensive monthly statement: general maintenance + water readings + arrears + total payable
  getPeriodStatement: (periodId: string) => api.get(`/billing/periods/${periodId}/statement`),

  // Published periods list — accessible to all society members (no admin role required)
  listPublishedPeriods: () => api.get('/billing/periods/published'),

  // Resident: view own bills
  getMyBills: (params?: Record<string, unknown>) => api.get('/billing/my-bills', { params }),
  getMyBill: (billId: string) => api.get(`/billing/my-bills/${billId}`),

  // Admin: update per-flat note on a bill (visible to all members on the statement)
  updateBillNotes: (billId: string, notes: string) =>
    api.patch(`/billing/bills/${billId}/notes`, { notes }),
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

  /** Settles an approved expense from a bank account. This is the only thing
   *  that debits Account.currentBalance for an expense — until it runs, the
   *  money is committed but the balance still shows it as available. */
  markPaid: (id: string, accountId: string) =>
    api.post(`/expenses/${id}/mark-paid`, { accountId }),
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

  /** Rescues announcements saved before isPublished was sent on create —
   *  those are invisible to residents until this is called. */
  publishAnnouncement: (id: string) =>
    api.post(`/announcements/${id}/publish`),
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
    allowPaymentProofUpload?: boolean;
    showAccountBalancesToResidents?: boolean; showExpensesToResidents?: boolean;
    publishStatementToResidents?: boolean; publishMeetingMinutes?: boolean;
    upiId?: string;
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
  bulkCreateFlats: (flats: Array<{
    buildingId: string;
    unitNumber: string;
    flatCode: string;
    area?: number;
    bedrooms?: number;
    bathrooms?: number;
    category?: string;
    status?: string;
    ownershipType?: string;
    parkingSlots?: number;
  }>): Promise<{ data: {
    createdCount: number;
    failedCount: number;
    created: { row: number; flatCode: string }[];
    failed: { row: number; flatCode?: string; error: string }[];
  } }> => api.post('/flats/bulk', { flats }),
  updateFlat: (id: string, data: unknown) => api.patch(`/flats/${id}`, data),
  deleteFlat: (id: string) => api.delete(`/flats/${id}`),

  stats: () => api.get('/societies/my/stats'),

  // Member management
  removeMember: (userId: string) => api.delete(`/users/society/${userId}/remove`),

  // Edit a resident's profile info (admin only — PATCH /users/:id)
  updateUser: (userId: string, data: { firstName?: string; lastName?: string; phone?: string }) =>
    api.patch(`/users/${userId}`, data),

  // Resident invite / join code (admin only)
  getJoinCode: (): Promise<{ data: { joinCode: string; generatedAt: string | null } }> =>
    api.get('/societies/my/join-code'),
  regenerateJoinCode: (): Promise<{ data: { joinCode: string; generatedAt: string } }> =>
    api.patch('/societies/my/regenerate-join-code'),

  // Resident-facing financial transparency — every figure gated
  // server-side by its own show*ToResidents flag, so this is safe to call
  // regardless of what the admin has actually turned on; matches the
  // mobile Society Finances screen.
  getFinancialSummary: (): Promise<{ data: {
    showBalances: boolean;
    showExpenses: boolean;
    totalBalance: number | null;
    monthlyExpenses: number | null;
    byCategory: Array<{ category: string; total: number }> | null;
  } }> => api.get('/societies/my/financial-summary'),

  // Pending join approvals — a flat already had an active resident when
  // this person joined via invite code (AuthService.joinSociety), so the
  // membership is parked PENDING until an admin approves or rejects it.
  pendingApprovals: (): Promise<{ data: Array<{
    id: string;
    joinedAt: string;
    user: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
    flat: { id: string; flatCode: string; unitNumber: string; building: { name: string } | null } | null;
  }> }> => api.get('/users/society/pending'),
  approvePending: (membershipId: string) => api.post(`/users/society/pending/${membershipId}/approve`),
  rejectPending: (membershipId: string) => api.post(`/users/society/pending/${membershipId}/reject`),
};

// Water billing
export const waterApi = {
  listConfigs: () => api.get('/water/configs'),
  createConfig: (data: unknown) => api.post('/water/configs', data),
  listReadings: (params?: Record<string, unknown>) => api.get('/water/readings', { params }),

  // Society Allocation: batch enter readings + composite costs for a period
  allocatePeriodCosts: (
    periodId: string,
    data: {
      readingDate: string;
      municipalWaterBill: number;
      tankerCost: number;
      commonElectricityBill: number;
      electricityWaterPercent: number;
      readings: { flatId: string; openingReading: number; closingReading: number; notes?: string }[];
    },
  ) => api.post(`/water/periods/${periodId}/allocate`, data),

  getPeriodSummary: (periodId: string) => api.get(`/water/periods/${periodId}/summary`),
};

// Billing period report (all bills + line items)
export const billingReportApi = {
  getPeriodReport: (periodId: string) => api.get(`/billing/periods/${periodId}/report`),
};

// Notifications
export interface NotificationRow {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  type: string | null;
  createdAt: string;
}

interface NotificationRecordRow {
  id: string;
  createdAt: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
  readAt: string | null;
  notification: { id: string; title: string; body: string; type: string } | null;
}

export const notificationsApi = {
  /**
   * GET /notifications/my's service returns `{ data, total }`, not
   * `{ data, meta }` — the global TransformInterceptor only unwraps a
   * service's return value in place when it sees BOTH keys, so this one
   * falls through to its default and gets wrapped a second time:
   * `{ success, data: { data: [...], total } }`, one level deeper than
   * every other list endpoint. Unwrapping once (`res.data.data`) leaves an
   * object, not the array the page needs — same root cause already found
   * and fixed on mobile (see Mobile/src/api/endpoints/notifications.api.ts).
   * Rows also nest title/body/read-state under `.notification`/`.status`
   * rather than flat `title`/`message`/`isRead` — flatten that here too so
   * the page can render rows directly.
   */
  listMine: async (params?: Record<string, unknown>): Promise<{ data: NotificationRow[] }> => {
    const res = await api.get<{ data: { data: NotificationRecordRow[]; total: number } }>(
      '/notifications/my',
      { params },
    );
    const rows = res.data?.data?.data ?? [];
    return {
      data: rows.map((row) => ({
        id: row.id,
        title: row.notification?.title ?? 'Notification',
        message: row.notification?.body ?? '',
        isRead: row.status === 'READ' || row.readAt != null,
        type: row.notification?.type ?? null,
        createdAt: row.createdAt,
      })),
    };
  },
  markRead: (id: string) => api.patch(`/notifications/my/${id}/read`, {}),
  send: (data: { title: string; body: string; type?: string }) =>
    api.post('/notifications', { type: 'GENERAL', ...data }),
};

// Users (society-scoped)
export const usersApi = {
  listSociety: (params?: Record<string, unknown>) => api.get('/users/society', { params }),
  addMember: (data: { userId: string; flatId?: string; role: string; isPrimary?: boolean }) =>
    api.post('/users/society/add-member', data),
  removeMember: (userId: string) => api.delete(`/users/society/${userId}/remove`),
};

// Salaries
export const salariesApi = {
  listEmployees: () => api.get('/salaries/employees'),
  createEmployee: (data: {
    name: string; designation: string; employeeCode?: string;
    phone?: string; email?: string; joinDate?: string; baseSalary: number;
  }) => api.post('/salaries/employees', data),
  listRecords: (params?: { month?: number; year?: number }) =>
    api.get('/salaries/records', { params }),
  processSalary: (data: {
    employeeId: string; salaryMonth: number; salaryYear: number;
    baseSalary?: number; additions?: number; deductions?: number;
    accountId?: string; notes?: string;
  }) => api.post('/salaries/process', data),
  paySalary: (recordId: string) => api.post(`/salaries/${recordId}/pay`),
};

// Meetings
export const meetingsApi = {
  list: (params?: Record<string, unknown>) => api.get('/meetings', { params }),
  create: (data: { title: string; meetingDate: string; location?: string; agenda?: string }) =>
    api.post('/meetings', data),
  get: (id: string) => api.get(`/meetings/${id}`),
  addMinutes: (id: string, data: { content: string; summary?: string }) =>
    api.post(`/meetings/${id}/minutes`, data),
  // Missing entirely before — minutes stayed unpublished forever, so no
  // resident could ever see them regardless of the publishMeetingMinutes
  // setting, since Meeting.isPublished never got set from this UI.
  publish: (id: string) => api.post(`/meetings/${id}/publish`, {}),
};

// Documents
export const documentsApi = {
  list: (params?: { category?: string }) => api.get('/documents', { params }),
  create: (data: {
    title: string; description?: string; fileName: string;
    fileKey: string; fileSize: number; mimeType: string;
    accessLevel: string; category?: string;
  }) => api.post('/documents', data),
  get: (id: string) => api.get(`/documents/${id}`),
  remove: (id: string) => api.delete(`/documents/${id}`),
};

// Helpdesk / Maintenance Requests
export const helpdeskApi = {
  list: (params?: { status?: string; category?: string; page?: number; limit?: number }) =>
    api.get('/helpdesk', { params }),
  get: (id: string) => api.get(`/helpdesk/${id}`),
  create: (data: {
    title: string; description?: string;
    category?: string; priority?: string; flatId?: string;
  }) => api.post('/helpdesk', data),
  updateStatus: (id: string, data: {
    status: string; adminNotes?: string; assignedToId?: string;
  }) => api.patch(`/helpdesk/${id}/status`, data),
};

// Audit Logs
export const auditLogsApi = {
  list: (params?: {
    page?: number; limit?: number; action?: string;
    entityType?: string; fromDate?: string; toDate?: string;
  }) => api.get('/audit-logs', { params }),
};

// Accounts & Funds
export const accountsApi = {
  listAccounts: (params?: Record<string, unknown>) => api.get('/accounts', { params }),
  /** An account is where money is tracked — a bank account or a cash box —
   *  not a connection to a bank. At least one must exist before any payment
   *  can be approved, since approval asks which account it landed in. */
  createAccount: (data: unknown) => api.post('/accounts', data),
  getAccount: (id: string) => api.get(`/accounts/${id}`),
  listFunds: (params?: Record<string, unknown>) => api.get('/funds', { params }),
  createFund: (data: unknown) => api.post('/funds', data),
  /** Adds money to a fund. Passing `accountId` also credits that bank
   *  account — correct for money arriving now, but double-counts anything
   *  already recorded through the payments flow. */
  contributeToFund: (
    id: string,
    data: { amount: number; description?: string; contributionDate?: string; accountId?: string },
  ) => api.post(`/funds/${id}/contribute`, data),
  getTransactions: (accountId: string, params?: Record<string, unknown>) =>
    api.get(`/accounts/${accountId}/transactions`, { params }),
};

// Platform admin — society directory. Every route here requires
// isPlatformAdmin (PlatformAdminGuard), not a society membership.
export interface PlatformSocietyAdmin {
  id: string; firstName: string; lastName: string; email: string; phone: string | null;
}
export interface PlatformSociety {
  id: string;
  name: string;
  displayName: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  joinCode: string | null;
  createdAt: string;
  _count: { memberships: number; buildings: number };
  admins: PlatformSocietyAdmin[];
}
export const platformApi = {
  listSocieties: (params?: { page?: number; limit?: number }): Promise<{ data: PaginatedResponse<PlatformSociety> }> =>
    api.get('/societies', { params }),
  getSociety: (id: string): Promise<{ data: PlatformSociety }> => api.get(`/societies/${id}`),

  stats: (): Promise<{
    data: {
      societies: number;
      activeSocieties: number;
      suspendedSocieties: number;
      buildings: number;
      flats: number;
      members: number;
      admins: number;
    };
  }> => api.get('/societies/platform/stats'),

  /** Suspend or reinstate. Nothing is deleted either way — memberships,
   *  bills and history are untouched, so reinstating restores it as it was. */
  setSocietyStatus: (id: string, isActive: boolean) =>
    api.patch(`/societies/${id}/status`, { isActive }),
};
