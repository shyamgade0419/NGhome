import apiClient from '@/api/client';

/**
 * Report response shapes mirror App/src/reports/reports.controller.ts exactly.
 * Note the inconsistency in the API itself: outstanding-dues and expense-summary
 * serialize amounts as numbers, while collection-summary returns strings.
 */

export interface OutstandingBill {
  id: string;
  invoiceNumber: string;
  flatCode: string;
  dueDate: string;
  isPaid: boolean;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  residentName: string | null;
}

export interface OutstandingDues {
  bills: OutstandingBill[];
  totalOutstanding: number;
}

export interface CollectionSummary {
  period?: { periodMonth: number; periodYear: number; status: string };
  totalBilled: string;
  totalCollected: string;
  totalPending: string;
  collectionRate: string;
  error?: string;
}

export interface ExpenseSummary {
  byCategory: Array<{ category: string; total: number }>;
  total: number;
  count: number;
}

export interface AccountBalance {
  id: string;
  name: string;
  accountType: string;
  bankName: string | null;
  currentBalance: number;
  openingBalance: number;
}

function unwrap<T>(data: any): T {
  return (data?.data ?? data) as T;
}

export const reportsApi = {
  outstandingDues: async () => {
    const { data } = await apiClient.get('/reports/outstanding-dues');
    return unwrap<OutstandingDues>(data);
  },

  collectionSummary: async (year: number, month: number) => {
    const { data } = await apiClient.get('/reports/collection-summary', {
      params: { year, month },
    });
    return unwrap<CollectionSummary>(data);
  },

  expenseSummary: async (fromDate: string, toDate: string) => {
    const { data } = await apiClient.get('/reports/expense-summary', {
      params: { fromDate, toDate },
    });
    return unwrap<ExpenseSummary>(data);
  },

  accountBalances: async () => {
    const { data } = await apiClient.get('/reports/account-balances');
    return unwrap<AccountBalance[]>(data);
  },
};
