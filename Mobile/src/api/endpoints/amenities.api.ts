import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse } from '@/api/types';

export type AmenityBookingMode = 'INSTANT' | 'NEEDS_APPROVAL';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export type FeeStatus = 'NONE' | 'DUE' | 'COLLECTED' | 'WAIVED';
export type SlotState = 'AVAILABLE' | 'FULL' | 'PAST' | 'TOO_FAR';

export interface Amenity {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  bookingMode: AmenityBookingMode;
  slotMinutes: number;
  /** Minutes since midnight, India time. */
  opensAtMin: number;
  closesAtMin: number;
  maxAdvanceDays: number;
  monthlyCapPerFlat: number | null;
  cancelBeforeHours: number;
  capacity: number;
  maxSlotsPerBooking: number;
  /** Decimal string, or null when free. */
  fee: string | null;
  isActive: boolean;
}

/** What the committee form sends. Omitted fields keep the server's defaults. */
export interface AmenityPayload {
  name?: string;
  description?: string;
  rules?: string;
  bookingMode?: AmenityBookingMode;
  slotMinutes?: number;
  opensAtMin?: number;
  closesAtMin?: number;
  maxAdvanceDays?: number;
  /** null clears the limit. */
  monthlyCapPerFlat?: number | null;
  cancelBeforeHours?: number;
  capacity?: number;
  maxSlotsPerBooking?: number;
  fee?: number;
  isActive?: boolean;
}

export interface Slot {
  startAt: string;
  endAt: string;
  remaining: number;
  state: SlotState;
  bookedByMyFlat: boolean;
}

export interface AmenityBooking {
  id: string;
  amenityId: string;
  flatId: string;
  userId: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  guestCount: number;
  note: string | null;
  /** Decimal string. */
  feeAmount: string;
  feeStatus: FeeStatus;
  rejectionReason: string | null;
  amenity?: { id: string; name: string };
  flat?: { id: string; flatCode: string };
  user?: { id: string; firstName: string; lastName: string };
}

export const amenitiesApi = {
  list: async (includeInactive = false) => {
    const { data } = await apiClient.get<ApiResponse<Amenity[]>>('/amenities', {
      params: includeInactive ? { all: 'true' } : undefined,
    });
    return data.data;
  },
  create: async (payload: AmenityPayload) => {
    const { data } = await apiClient.post<ApiResponse<Amenity>>('/amenities', payload);
    return data.data;
  },
  update: async (id: string, payload: AmenityPayload) => {
    const { data } = await apiClient.patch<ApiResponse<Amenity>>(`/amenities/${id}`, payload);
    return data.data;
  },
  availability: async (id: string, date: string) => {
    const { data } = await apiClient.get<ApiResponse<{ amenityId: string; date: string; slots: Slot[] }>>(
      `/amenities/${id}/availability`,
      { params: { date } },
    );
    return data.data;
  },
};

export const amenityBookingsApi = {
  book: async (payload: { amenityId: string; startAt: string; slots?: number; guestCount?: number; note?: string }) => {
    const { data } = await apiClient.post<ApiResponse<AmenityBooking>>('/amenity-bookings', payload);
    return data.data;
  },
  mine: async () => {
    const { data } = await apiClient.get<PaginatedResponse<AmenityBooking>>('/amenity-bookings/my', {
      params: { limit: 100 },
    });
    return data;
  },
  all: async (params?: { status?: BookingStatus; amenityId?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<AmenityBooking>>('/amenity-bookings', {
      params: { limit: 100, ...params },
    });
    return data;
  },
  cancel: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<{ id: string; status: BookingStatus }>>(
      `/amenity-bookings/${id}/cancel`,
    );
    return data.data;
  },
  approve: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<AmenityBooking>>(`/amenity-bookings/${id}/approve`);
    return data.data;
  },
  reject: async (id: string, reason?: string) => {
    const { data } = await apiClient.post<ApiResponse<AmenityBooking>>(`/amenity-bookings/${id}/reject`, { reason });
    return data.data;
  },
  collectFee: async (id: string, accountId: string) => {
    const { data } = await apiClient.post<ApiResponse<AmenityBooking>>(`/amenity-bookings/${id}/fee/collect`, {
      accountId,
    });
    return data.data;
  },
  waiveFee: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<AmenityBooking>>(`/amenity-bookings/${id}/fee/waive`);
    return data.data;
  },
};

/** The server's own message when it has one (slot taken, window passed, …), else a generic fallback. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join('\n');
  return message || fallback;
}
