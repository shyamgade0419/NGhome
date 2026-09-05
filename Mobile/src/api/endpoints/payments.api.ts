import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import apiClient, { API_BASE_URL } from '@/api/client';
import { tokenService } from '@/auth/token.service';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';
import { PaymentSubmission } from '@/types/billing.types';

export const paymentsApi = {
  // `proof` (a receipt/screenshot) is optional and sent as multipart —
  // matches documentsApi.upload's pattern. Backend field name is "proof".
  submitPayment: async (payload: {
    maintenanceBillId?: string;
    billingPeriodId?: string;
    amount: string;
    paymentDate: string;
    paymentMethod: string;
    referenceNumber?: string;
    notes?: string;
    proof?: { uri: string; name: string; mimeType?: string | null };
  }) => {
    const { proof, ...fields } = payload;
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined) form.append(key, String(value));
    });
    if (proof) {
      form.append('proof', {
        uri: proof.uri,
        name: proof.name,
        type: proof.mimeType || 'image/jpeg',
      } as unknown as Blob);
    }

    const { data } = await apiClient.post<ApiResponse<PaymentSubmission>>('/payments', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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

  /** Download and open the receipt/screenshot attached to a payment —
   *  same download-then-share pattern as documentsApi.openFile. Works for
   *  the submitting resident or an admin/accountant reviewing it; backend
   *  enforces that (GET /payments/:id/proof), not this. */
  openProof: async (paymentId: string, fileName: string): Promise<void> => {
    const token = await tokenService.getAccessToken();
    const localUri = `${FileSystem.cacheDirectory}${Date.now()}-${fileName}`;
    const result = await FileSystem.downloadAsync(`${API_BASE_URL}/payments/${paymentId}/proof`, localUri, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (result.status !== 200) {
      throw new Error(`Failed to download receipt (status ${result.status})`);
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(result.uri);
    }
  },
};
