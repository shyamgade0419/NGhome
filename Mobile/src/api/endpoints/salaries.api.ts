import apiClient from '@/api/client';
import { ApiResponse } from '@/api/types';

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

  /**
   * findSalaryRecords returns a bare array (prisma.salaryRecord.findMany()
   * directly), not the {data, meta} wrapper every paginated list elsewhere
   * in this API returns. Web already works around this with `.data ?? r`;
   * mirror it rather than assume the wrapper exists.
   */
  listRecords: async (params?: { month?: number; year?: number }) => {
    const { data } = await apiClient.get<SalaryRecord[] | { data: SalaryRecord[] }>(
      '/salaries/records',
      { params },
    );
    const records = Array.isArray(data) ? data : (data?.data ?? []);
    return { data: records, meta: { total: records.length, page: 1, limit: records.length, totalPages: 1 } };
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
