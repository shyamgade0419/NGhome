import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';

export type AccountType = 'SAVINGS' | 'CURRENT' | 'FIXED_DEPOSIT' | 'CASH' | 'OTHER';

export interface SocietyAccount {
  id: string;
  name: string;
  accountType: AccountType;
  bankName: string | null;
  accountNumberMasked: string | null;
  ifscCode: string | null;
  openingBalance: string;
  currentBalance: string;
  isActive: boolean;
  description: string | null;
}

export interface AccountTransaction {
  id: string;
  transactionType: string;
  amount: string;
  description: string | null;
  referenceNumber: string | null;
  transactionDate: string;
  createdAt: string;
}

export const accountsApi = {
  /**
   * An account is where the society's money is tracked — a bank account or a
   * cash box — not a connection to a bank. Nothing syncs a real balance;
   * currentBalance moves only as payments are approved and expenses and
   * salaries are paid.
   *
   * At least one has to exist before any payment can be approved, since
   * approval asks which account the money landed in. Registration creates
   * none, so without this a new society could take payments and never
   * record a single one.
   */
  create: async (payload: {
    name: string;
    accountType: AccountType;
    bankName?: string;
    accountNumberMasked?: string;
    ifscCode?: string;
    openingBalance?: number;
    description?: string;
  }) => {
    const { data } = await apiClient.post('/accounts', payload);
    return ((data as any)?.data ?? data) as SocietyAccount;
  },

  list: async () => {
    const { data } = await apiClient.get<ApiResponse<SocietyAccount[]>>('/accounts');
    return data.data ?? (data as unknown as SocietyAccount[]);
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<SocietyAccount>>(`/accounts/${id}`);
    return data.data ?? (data as unknown as SocietyAccount);
  },

  transactions: async (accountId: string, query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<AccountTransaction>>(
      `/accounts/${accountId}/transactions`,
      { params: query },
    );
    return data;
  },
};

/** Matches the real Fund model — fundType and targetAmount never existed. */
export interface SocietyFund {
  id: string;
  name: string;
  currentBalance: string;
  openingBalance: string;
  description: string | null;
  isVisibleToResidents: boolean;
}

export const fundsApi = {
  list: async () => {
    const { data } = await apiClient.get('/funds');
    return ((data as any)?.data ?? data) as SocietyFund[];
  },

  create: async (payload: {
    name: string;
    description?: string;
    accountId?: string;
    openingBalance?: number;
    isVisibleToResidents?: boolean;
  }) => {
    const { data } = await apiClient.post('/funds', payload);
    return ((data as any)?.data ?? data) as SocietyFund;
  },

  /** Adds money to a fund. `accountId` is optional and deliberately so —
   *  see the backend DTO: passing it also credits that bank account, which
   *  is right for money arriving now but double-counts money that already
   *  came in through the payments flow. */
  contribute: async (
    id: string,
    payload: { amount: number; description?: string; contributionDate?: string; accountId?: string },
  ) => {
    const { data } = await apiClient.post(`/funds/${id}/contribute`, payload);
    return ((data as any)?.data ?? data) as SocietyFund;
  },
};
