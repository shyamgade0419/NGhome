import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';
import { PaymentSubmission } from '@/types/billing.types';

export const paymentsApi = {
  submitPayment: async (payload: {
    maintenanceBillId?: string;
    billingPeriodId?: string;
    amount: string;
    paymentDate: string;
    paymentMethod: string;
    referenceNumber?: string;
    notes?: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<PaymentSubmission>>('/payments', payload);
    return data.data;
  },

  // Resident: my payment history
  getMyPayments: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<PaymentSubmission>>(
      '/payments/my',
      { params: query },
    );
    return data;
  },

  // Admin: all society payments
  getAllPayments: async (query?: PaginationQuery & { status?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<PaymentSubmission>>('/payments', {
      params: query,
    });
    return data;
  },

  getPayment: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<PaymentSubmission>>(`/payments/${id}`);
    return data.data;
  },

  // accountId: the society account to credit — fetch from GET /accounts and pass the main account
  approvePayment: async (id: string, accountId: string, notes?: string) => {
    const { data } = await apiClient.post<ApiResponse<PaymentSubmission>>(
      `/payments/${id}/approve`,
      { accountId, notes },
    );
    return data.data;
  },

  rejectPayment: async (id: string, reason: string) => {
    const { data } = await apiClient.post<ApiResponse<PaymentSubmission>>(
      `/payments/${id}/reject`,
      { reason },
    );
    return data.data;
  },
};
