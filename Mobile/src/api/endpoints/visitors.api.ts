import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse } from '@/api/types';

export type VisitorType = 'GUEST' | 'CAB' | 'DELIVERY' | 'SERVICE' | 'OTHER';
export type VisitorEntryStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'EXPIRED';
export type InvitationState = 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'REVOKED';
export type DecisionMethod = 'RESIDENT' | 'POLICY' | 'INVITATION' | 'ADMIN_OVERRIDE';

export interface VisitorEntry {
  id: string;
  flatId: string;
  flatCode: string | null;
  invitationId: string | null;
  visitorName: string;
  visitorPhone: string | null;
  visitorType: VisitorType;
  vehicleNumber: string | null;
  purpose: string | null;
  status: VisitorEntryStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decisionMethod: DecisionMethod | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  /** Present on the committee's log. */
  registeredBy?: string | null;
  decidedBy?: string | null;
  checkedInBy?: string | null;
  checkedOutBy?: string | null;
}

export interface VisitorInvitation {
  id: string;
  visitorName: string;
  visitorPhone: string | null;
  visitorType: VisitorType;
  note: string | null;
  validFrom: string;
  validUntil: string;
  maxUses: number;
  usedCount: number;
  state: InvitationState;
}

/** The code exists only in the response that creates the invitation. */
export type CreatedInvitation = VisitorInvitation & { code: string };

export interface VisitorPolicy {
  walkInApproval: 'REQUIRED' | 'NOT_REQUIRED';
  maxInviteDays: number;
  maxUsesPerInvite: number;
  approvalWindowMinutes: number;
}

export interface GateFlat {
  id: string;
  flatCode: string;
  buildingName: string | null;
}

export interface InvitePayload {
  visitorName: string;
  visitorPhone?: string;
  visitorType?: VisitorType;
  note?: string;
  validFrom?: string;
  validUntil: string;
  maxUses?: number;
}

export interface WalkInPayload {
  flatId: string;
  visitorName: string;
  visitorPhone?: string;
  visitorType?: VisitorType;
  vehicleNumber?: string;
  purpose?: string;
  clientRequestId: string;
}

export const visitorsApi = {
  // resident
  invite: async (payload: InvitePayload) => {
    const { data } = await apiClient.post<ApiResponse<CreatedInvitation>>('/visitor-invitations', payload);
    return data.data;
  },
  myInvitations: async () => {
    const { data } = await apiClient.get<ApiResponse<VisitorInvitation[]>>('/visitor-invitations/my');
    return data.data;
  },
  revokeInvitation: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<VisitorInvitation>>(`/visitor-invitations/${id}/revoke`);
    return data.data;
  },
  myVisitors: async (status?: VisitorEntryStatus) => {
    const { data } = await apiClient.get<ApiResponse<VisitorEntry[]>>('/visitors/my', { params: status ? { status } : undefined });
    return data.data;
  },
  approve: async (id: string, note?: string) => {
    const { data } = await apiClient.post<ApiResponse<VisitorEntry>>(`/visitors/${id}/approve`, { note });
    return data.data;
  },
  reject: async (id: string, note?: string) => {
    const { data } = await apiClient.post<ApiResponse<VisitorEntry>>(`/visitors/${id}/reject`, { note });
    return data.data;
  },
  policy: async () => {
    const { data } = await apiClient.get<ApiResponse<VisitorPolicy>>('/visitors/policy');
    return data.data;
  },

  // gate
  gateFlats: async (search?: string) => {
    const { data } = await apiClient.get<ApiResponse<GateFlat[]>>('/gate/flats', { params: search ? { search } : undefined });
    return data.data;
  },
  walkIn: async (payload: WalkInPayload) => {
    const { data } = await apiClient.post<ApiResponse<{ entry: VisitorEntry; duplicate: boolean; notifiedResidents: number }>>('/gate/walk-ins', payload);
    return data.data;
  },
  scan: async (code: string, clientRequestId: string) => {
    const { data } = await apiClient.post<ApiResponse<{ entry: VisitorEntry; duplicate: boolean }>>('/gate/scan', { code, clientRequestId });
    return data.data;
  },
  gateList: async (search?: string) => {
    const { data } = await apiClient.get<ApiResponse<VisitorEntry[]>>('/gate/visitors', { params: search ? { search } : undefined });
    return data.data;
  },
  checkIn: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<VisitorEntry>>(`/gate/visitors/${id}/check-in`);
    return data.data;
  },
  checkOut: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<VisitorEntry>>(`/gate/visitors/${id}/check-out`);
    return data.data;
  },

  // committee
  log: async (params?: { page?: number; limit?: number; status?: VisitorEntryStatus; search?: string; from?: string; to?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<VisitorEntry>>('/visitors', { params: { limit: 50, ...params } });
    return data;
  },
  override: async (id: string, action: 'APPROVE' | 'REJECT', reason: string) => {
    const { data } = await apiClient.post<ApiResponse<VisitorEntry>>(`/visitors/${id}/override`, { action, reason });
    return data.data;
  },
  updatePolicy: async (patch: Partial<VisitorPolicy>) => {
    const { data } = await apiClient.put<ApiResponse<VisitorPolicy>>('/visitors/policy', patch);
    return data.data;
  },
};
