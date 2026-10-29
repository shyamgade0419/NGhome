import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

export type DeliveryInstruction = 'ALLOW_ENTRY' | 'LEAVE_AT_GATE';
export type ExpectationState = 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'CANCELLED';
export type ParcelStatus = 'RECEIVED' | 'COLLECTED' | 'RETURNED';

/** A resident's "a delivery is coming" instruction. */
export interface DeliveryExpectation {
  id: string;
  flatId: string;
  company: string;
  instruction: DeliveryInstruction;
  note: string | null;
  validFrom: string;
  validUntil: string;
  maxUses: number;
  usedCount: number;
  state: ExpectationState;
  /** Present on the gate's list. */
  flatCode?: string;
}

export interface Parcel {
  id: string;
  flatId: string;
  flatCode: string | null;
  courier: string;
  recipientName: string | null;
  note: string | null;
  status: ParcelStatus;
  receivedAt: string;
  closedAt: string | null;
  collectedByName: string | null;
}

export interface ExpectationPayload {
  company: string;
  instruction: DeliveryInstruction;
  note?: string;
  validUntil?: string;
  maxUses?: number;
}

export interface ReceiveParcelPayload {
  flatId: string;
  courier: string;
  recipientName?: string;
  note?: string;
  clientRequestId: string;
}

export const deliveriesApi = {
  // resident
  expect: async (payload: ExpectationPayload) => {
    const { data } = await apiClient.post<ApiResponse<DeliveryExpectation>>('/delivery-expectations', payload);
    return data.data;
  },
  myExpectations: async () => {
    const { data } = await apiClient.get<ApiResponse<DeliveryExpectation[]>>('/delivery-expectations/my');
    return data.data;
  },
  cancelExpectation: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<DeliveryExpectation>>(`/delivery-expectations/${id}/cancel`);
    return data.data;
  },
  myParcels: async () => {
    const { data } = await apiClient.get<ApiResponse<Parcel[]>>('/parcels/my');
    return data.data;
  },

  // gate
  expected: async () => {
    const { data } = await apiClient.get<ApiResponse<DeliveryExpectation[]>>('/gate/deliveries/expected');
    return data.data;
  },
  receive: async (payload: ReceiveParcelPayload) => {
    const { data } = await apiClient.post<ApiResponse<{ parcel: Parcel; duplicate: boolean; notifiedResidents: number }>>('/gate/parcels', payload);
    return data.data;
  },
  gateParcels: async (search?: string) => {
    const { data } = await apiClient.get<ApiResponse<Parcel[]>>('/gate/parcels', { params: search ? { search } : undefined });
    return data.data;
  },
  handOver: async (id: string, collectedByName?: string) => {
    const { data } = await apiClient.post<ApiResponse<Parcel>>(`/gate/parcels/${id}/hand-over`, collectedByName ? { collectedByName } : {});
    return data.data;
  },
  returnParcel: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<Parcel>>(`/gate/parcels/${id}/return`);
    return data.data;
  },
};
