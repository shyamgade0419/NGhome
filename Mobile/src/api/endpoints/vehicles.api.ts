import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

export type VehicleKind = 'CAR' | 'TWO_WHEELER' | 'CYCLE' | 'OTHER';
export type SlotFor = 'CAR' | 'TWO_WHEELER' | 'ANY';

/** A vehicle registered to my flat. */
export interface MyVehicle {
  id: string;
  plate: string;
  kind: VehicleKind;
  make: string | null;
  colour: string | null;
  slots: { id: string; code: string }[];
}

/** A parking slot allocated to my flat. */
export interface MySlot {
  id: string;
  code: string;
  area: string | null;
  slotFor: SlotFor;
  vehicleId: string | null;
  vehiclePlate: string | null;
  vehicleKind: VehicleKind | null;
}

/** What the guard sees for a vehicle: the flat number and slot, never a name or phone. */
export interface VehicleHit {
  id: string;
  plate: string;
  kind: VehicleKind;
  make: string | null;
  colour: string | null;
  flatCode: string;
  slotCodes: string[];
}

export interface AddVehiclePayload {
  plate: string;
  kind: VehicleKind;
  make?: string;
  colour?: string;
}

export const vehiclesApi = {
  add: async (payload: AddVehiclePayload) => {
    const { data } = await apiClient.post<ApiResponse<MyVehicle>>('/vehicles', payload);
    return data.data;
  },
  mine: async () => {
    const { data } = await apiClient.get<ApiResponse<MyVehicle[]>>('/vehicles/my');
    return data.data;
  },
  remove: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<{ removed: boolean }>>(`/vehicles/${id}/remove`, {});
    return data.data;
  },
  mySlots: async () => {
    const { data } = await apiClient.get<ApiResponse<MySlot[]>>('/parking/my');
    return data.data;
  },
  /** Say which of my vehicles uses one of my slots; null clears it. */
  assign: async (slotId: string, vehicleId: string | null) => {
    const { data } = await apiClient.post<ApiResponse<MySlot>>(`/parking/${slotId}/assign-vehicle`, { vehicleId });
    return data.data;
  },

  // gate
  lookup: async (search: string) => {
    const { data } = await apiClient.get<ApiResponse<VehicleHit[]>>('/gate/vehicles/lookup', { params: { search } });
    return data.data;
  },
};
