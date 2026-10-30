// Legacy file-system import, for the same reason as documents.api.ts: the download's HTTP status.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import apiClient, { API_BASE_URL } from '@/api/client';
import { tokenService } from '@/auth/token.service';
import { ApiResponse } from '@/api/types';
import { Receipt, StoredReceipt } from '@/utils/receipts';

export const expensesApi = {
  /**
   * One receipt for one expense, sent as multipart under "file". RN needs the file as a plain
   * {uri, name, type} object and the bare multipart Content-Type — it adds the boundary itself.
   */
  uploadReceipt: async (expenseId: string, receipt: Receipt): Promise<StoredReceipt> => {
    const form = new FormData();
    form.append('file', { uri: receipt.uri, name: receipt.name, type: receipt.mimeType } as unknown as Blob);
    const { data } = await apiClient.post<ApiResponse<StoredReceipt>>(`/expenses/${expenseId}/receipts`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data.data;
  },

  /** Downloads the receipt and hands it to the phone's share / open sheet — there is no in-app viewer. */
  openReceipt: async (expenseId: string, receipt: StoredReceipt): Promise<void> => {
    const token = await tokenService.getAccessToken();
    const localUri = `${FileSystem.cacheDirectory}${Date.now()}-${receipt.fileName}`;
    const result = await FileSystem.downloadAsync(`${API_BASE_URL}/expenses/${expenseId}/receipts/${receipt.id}/file`, localUri, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (result.status !== 200) throw new Error(`Failed to download receipt (status ${result.status})`);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri);
  },

  removeReceipt: async (expenseId: string, receiptId: string): Promise<void> => {
    await apiClient.delete(`/expenses/${expenseId}/receipts/${receiptId}`);
  },
};
