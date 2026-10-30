import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

export type AttendanceStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE';

/** A member of staff as the guard sees them today: no pay details, no phone number. */
export interface GateStaff {
  employeeId: string;
  name: string;
  designation: string;
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  post: string | null;
  dayOff: boolean;
  status: AttendanceStatus | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  inside: boolean;
}

export interface StaffAttendance {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number | null;
  late: boolean;
}

export const staffApi = {
  gateStaff: async () => {
    const { data } = await apiClient.get<ApiResponse<GateStaff[]>>('/gate/staff');
    return data.data;
  },
  checkIn: async (employeeId: string) => {
    const { data } = await apiClient.post<ApiResponse<{ attendance: StaffAttendance; alreadyIn: boolean }>>(`/gate/staff/${employeeId}/check-in`);
    return data.data;
  },
  checkOut: async (employeeId: string) => {
    const { data } = await apiClient.post<ApiResponse<{ attendance: StaffAttendance; alreadyOut: boolean }>>(`/gate/staff/${employeeId}/check-out`);
    return data.data;
  },
};
