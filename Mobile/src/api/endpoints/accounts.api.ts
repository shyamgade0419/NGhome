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
};
