import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse } from '@/api/types';

export type SalaryStatus = 'DRAFT' | 'PROCESSED' | 'PAID';

export interface Employee {
  id: string;
  name: string;
  designation: string;
  employeeCode: string | null;
  phone: string | null;
  email: string | null;
  joinDate: string | null;
  baseSalary: string;
  isActive: boolean;
}

export interface SalaryRecord {
  id: string;
  employeeId: string;
  salaryMonth: number;
  salaryYear: number;
  baseSalary: string;
  additions: string;
  deductions: string;
  netSalary: string;
  status: SalaryStatus;
  paymentDate: string | null;
  notes: string | null;
  employee?: { name: string; designation: string } | null;
}

function unwrap<T>(data: any): T {
  return (data?.data ?? data) as T;
}

export const salariesApi = {
  listEmployees: async () => {
    const { data } = await apiClient.get('/salaries/employees');
    return unwrap<Employee[]>(data);
  },

  listRecords: async (params?: { month?: number; year?: number }) => {
    const { data } = await apiClient.get<PaginatedResponse<SalaryRecord>>('/salaries/records', {
      params,
    });
    return data;
  },

  process: async (payload: {
    employeeId: string;
    salaryMonth: number;
    salaryYear: number;
    baseSalary?: number;
    additions?: number;
    deductions?: number;
    notes?: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<SalaryRecord>>('/salaries/process', payload);
    return data.data ?? (data as unknown as SalaryRecord);
  },

  pay: async (recordId: string): Promise<void> => {
    await apiClient.post(`/salaries/${recordId}/pay`, {});
  },
};
