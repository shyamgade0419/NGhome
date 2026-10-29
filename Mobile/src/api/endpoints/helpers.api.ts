import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

export type HelperRole = 'MAID' | 'COOK' | 'DRIVER' | 'NANNY' | 'CLEANER' | 'GARDENER' | 'OTHER';
export type HelperStatus = 'ACTIVE' | 'SUSPENDED';

/** Someone who works in my home, as my household sees them. */
export interface MyHelper {
  id: string;
  name: string;
  phone: string | null;
  role: HelperRole;
  status: HelperStatus;
  verified: boolean;
  suspendedReason: string | null;
  inside: boolean;
  lastVisitAt: string | null;
}

/** Someone the guard can let in. No phone number: the guard needs a name and a destination. */
export interface GateHelper {
  id: string;
  name: string;
  role: HelperRole;
  status: HelperStatus;
  verified: boolean;
  flatCodes: string[];
  inside: boolean;
}

export interface HelperVisit {
  id: string;
  helperId: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  method: 'CODE' | 'GUARD';
  autoClosed: boolean;
}

/** A visit on the gate's list, with who it was. */
export type GateHelperVisit = HelperVisit & { name: string; role: HelperRole; flatCodes: string[] };

export interface AddHelperPayload {
  name: string;
  role: HelperRole;
  phone?: string;
}

export type AddHelperResult = { helper: Omit<MyHelper, 'inside' | 'lastVisitAt'>; linked: boolean; code?: string };
export type EnterResult = {
  visit: HelperVisit;
  duplicate: boolean;
  alreadyInside: boolean;
  /** Who was let in, so the guard can match the face to the name. */
  helper: { id: string; name: string; role: HelperRole; flatCodes: string[] };
};

export const helpersApi = {
  // resident
  add: async (payload: AddHelperPayload) => {
    const { data } = await apiClient.post<ApiResponse<AddHelperResult>>('/domestic-helpers', payload);
    return data.data;
  },
  mine: async () => {
    const { data } = await apiClient.get<ApiResponse<MyHelper[]>>('/domestic-helpers/my');
    return data.data;
  },
  remove: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<{ removed: boolean }>>(`/domestic-helpers/${id}/remove`);
    return data.data;
  },
  newCode: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<{ code: string }>>(`/domestic-helpers/${id}/new-code`);
    return data.data;
  },
  visits: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<HelperVisit[]>>(`/domestic-helpers/${id}/visits`);
    return data.data;
  },

  // gate
  gateHelpers: async (search?: string) => {
    const { data } = await apiClient.get<ApiResponse<GateHelper[]>>('/gate/helpers', { params: search ? { search } : undefined });
    return data.data;
  },
  gateVisits: async () => {
    const { data } = await apiClient.get<ApiResponse<GateHelperVisit[]>>('/gate/helper-visits');
    return data.data;
  },
  checkIn: async (id: string, clientRequestId: string) => {
    const { data } = await apiClient.post<ApiResponse<EnterResult>>(`/gate/helpers/${id}/check-in`, { clientRequestId });
    return data.data;
  },
  scan: async (code: string, clientRequestId: string) => {
    const { data } = await apiClient.post<ApiResponse<EnterResult>>('/gate/helpers/scan', { code, clientRequestId });
    return data.data;
  },
  checkOut: async (visitId: string) => {
    const { data } = await apiClient.post<ApiResponse<HelperVisit>>(`/gate/helper-visits/${visitId}/check-out`);
    return data.data;
  },
};
