'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCircle, IndianRupee, CheckCircle2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { salariesApi, accountsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

function salaryStatusBadge(status: string) {
  if (status === 'PAID') return <Badge variant="success">Paid</Badge>;
  if (status === 'PROCESSED') return <Badge variant="info">Processed</Badge>;
  return <Badge variant="warning">Pending</Badge>;
}

function AddEmployeeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', designation: '', employeeCode: '',
    phone: '', email: '',
    joinDate: new Date().toISOString().split('T')[0],
    baseSalary: '',
  });

  const mutation = useMutation({
    mutationFn: () => salariesApi.createEmployee({
      name: form.name.trim(),
      designation: form.designation.trim(),
      employeeCode: form.employeeCode.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      joinDate: form.joinDate ? new Date(form.joinDate).toISOString() : undefined,
      baseSalary: Number(form.baseSalary),
    }),
    onSuccess: () => {
      toast.success('Employee added');
      qc.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add employee'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Employee</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Full Name *" placeholder="Ramesh Kumar" value={form.name} onChange={set('name')} />
            <Input label="Designation *" placeholder="Security Guard" value={form.designation} onChange={set('designation')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Employee Code" placeholder="EMP001" value={form.employeeCode} onChange={set('employeeCode')} />
            <Input label="Join Date" type="date" value={form.joinDate} onChange={set('joinDate')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Phone" placeholder="9876543210" value={form.phone} onChange={set('phone')} />
            <Input label="Email" type="email" placeholder="employee@example.com" value={form.email} onChange={set('email')} />
          </div>
          <Input label="Base Salary (₹) *" type="number" placeholder="15000" value={form.baseSalary} onChange={set('baseSalary')} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.name.trim() || !form.designation.trim() || !form.baseSalary}
          >
            Add Employee
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProcessSalaryModal({
  employees,
  accounts,
  onClose,
}: {
  employees: any[];
  accounts: any[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const now = new Date();
  const [form, setForm] = useState({
    employeeId: '',
    salaryMonth: String(now.getMonth() + 1),
    salaryYear: String(now.getFullYear()),
    additions: '',
    deductions: '',
    accountId: accounts[0]?.id ?? '',
    notes: '',
  });

  const selectedEmp = employees.find((e: any) => e.id === form.employeeId);

  const mutation = useMutation({
    mutationFn: () => salariesApi.processSalary({
      employeeId: form.employeeId,
      salaryMonth: Number(form.salaryMonth),
      salaryYear: Number(form.salaryYear),
      additions: form.additions ? Number(form.additions) : undefined,
      deductions: form.deductions ? Number(form.deductions) : undefined,
      accountId: form.accountId || undefined,
      notes: form.notes.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Salary processed');
      qc.invalidateQueries({ queryKey: ['salary-records'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to process salary'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const netPay = selectedEmp
    ? (parseFloat(selectedEmp.baseSalary ?? 0) + (Number(form.additions) || 0) - (Number(form.deductions) || 0))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Process Salary</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Select
            label="Employee *"
            value={form.employeeId}
            onChange={set('employeeId')}
            options={[
              { value: '', label: 'Select employee…' },
              ...employees.map((e: any) => ({ value: e.id, label: `${e.name} — ${e.designation}` })),
            ]}
          />
          {selectedEmp && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Base: ₹{parseFloat(selectedEmp.baseSalary ?? 0).toLocaleString('en-IN')}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Select label="Month *" value={form.salaryMonth} onChange={set('salaryMonth')} options={MONTHS} />
            <Input label="Year *" type="number" value={form.salaryYear} onChange={set('salaryYear')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Additions (₹)" type="number" placeholder="Bonus, overtime…" value={form.additions} onChange={set('additions')} />
            <Input label="Deductions (₹)" type="number" placeholder="Advance, absent…" value={form.deductions} onChange={set('deductions')} />
          </div>
          {accounts.length > 0 && (
            <Select
              label="Debit Account"
              value={form.accountId}
              onChange={set('accountId')}
              options={accounts.map((a: any) => ({ value: a.id, label: a.name }))}
            />
          )}
          <Input label="Notes" placeholder="Any remarks" value={form.notes} onChange={set('notes')} />
          {selectedEmp && (
            <div className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 flex justify-between items-center">
              <span className="text-sm font-medium text-primary-700">Net Pay</span>
              <span className="text-base font-bold text-primary-700">₹{netPay.toLocaleString('en-IN')}</span>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.employeeId || !form.salaryMonth || !form.salaryYear}
          >
            Process Salary
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SalariesPage() {
  const { user, activeMembership } = useAuth();
  const qc = useQueryClient();
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showProcess, setShowProcess] = useState(false);
  const [tab, setTab] = useState<'employees' | 'records'>('records');
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1));
  const [filterYear, setFilterYear] = useState(String(now.getFullYear()));

  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN' ||
    activeMembership?.role === 'SOCIETY_ACCOUNTANT' || !!user?.isPlatformAdmin;

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => salariesApi.listEmployees().then((r: any) => r.data ?? r),
  });

  const { data: records, isLoading: recLoading } = useQuery({
    queryKey: ['salary-records', filterMonth, filterYear],
    queryFn: () => salariesApi.listRecords({
      month: Number(filterMonth) || undefined,
      year: Number(filterYear) || undefined,
    }).then((r: any) => r.data ?? r),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.listAccounts().then((r: any) => r.data ?? r),
  });

  const payMutation = useMutation({
    mutationFn: (id: string) => salariesApi.paySalary(id),
    onSuccess: () => {
      toast.success('Salary marked as paid');
      qc.invalidateQueries({ queryKey: ['salary-records'] });
    },
    onError: () => toast.error('Failed to mark as paid'),
  });

  const empList: any[] = Array.isArray(employees) ? employees : (employees?.data ?? []);
  const recList: any[] = Array.isArray(records) ? records : (records?.data ?? []);
  const accountList: any[] = Array.isArray(accountsData) ? accountsData : (accountsData?.data ?? []);

  return (
    <>
      {showAddEmp && <AddEmployeeModal onClose={() => setShowAddEmp(false)} />}
      {showProcess && (
        <ProcessSalaryModal
          employees={empList}
          accounts={accountList}
          onClose={() => setShowProcess(false)}
        />
      )}
      <Header
        title="Staff Salaries"
        actions={isAdmin ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowAddEmp(true)}>
              <Plus size={14} className="mr-1" /> Add Employee
            </Button>
            <Button size="sm" onClick={() => setShowProcess(true)}>
              <IndianRupee size={14} className="mr-1" /> Process Salary
            </Button>
          </div>
        ) : undefined}
      />
      <PageContainer>
        {/* Tab selector */}
        <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          {(['records', 'employees'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t === 'records' ? 'Salary Records' : 'Employees'}
            </button>
          ))}
        </div>

        {tab === 'records' && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Select label="" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} options={MONTHS} className="w-36" />
              <Input label="" type="number" value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="w-24" />
            </div>
            {recLoading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : recList.length === 0 ? (
              <EmptyState
                icon={IndianRupee}
                title="No salary records"
                description="No salaries have been processed for this period."
                action={isAdmin ? <Button size="sm" onClick={() => setShowProcess(true)}><IndianRupee size={14} className="mr-1" /> Process Salary</Button> : undefined}
              />
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Employee</Th>
                    <Th>Period</Th>
                    <Th className="text-right">Base</Th>
                    <Th className="text-right">Additions</Th>
                    <Th className="text-right">Deductions</Th>
                    <Th className="text-right">Net Pay</Th>
                    <Th>Status</Th>
                    {isAdmin && <Th></Th>}
                  </Tr>
                </Thead>
                <Tbody>
                  {recList.map((rec: any) => (
                    <Tr key={rec.id}>
                      <Td>
                        <div>
                          <p className="font-medium text-slate-900">{rec.employee?.name ?? '—'}</p>
                          <p className="text-xs text-slate-500">{rec.employee?.designation}</p>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-sm text-slate-600">
                          {MONTHS.find((m) => m.value === String(rec.salaryMonth))?.label} {rec.salaryYear}
                        </span>
                      </Td>
                      <Td className="text-right font-mono text-sm">{formatCurrency(rec.baseSalary ?? 0)}</Td>
                      <Td className="text-right font-mono text-sm text-emerald-600">
                        {rec.additions ? `+${formatCurrency(rec.additions)}` : '—'}
                      </Td>
                      <Td className="text-right font-mono text-sm text-red-500">
                        {rec.deductions ? `-${formatCurrency(rec.deductions)}` : '—'}
                      </Td>
                      <Td className="text-right font-mono text-sm font-semibold">{formatCurrency(rec.netSalary ?? rec.baseSalary ?? 0)}</Td>
                      <Td>{salaryStatusBadge(rec.status)}</Td>
                      {isAdmin && (
                        <Td>
                          {rec.status === 'PROCESSED' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                if (confirm('Mark this salary as paid?')) payMutation.mutate(rec.id);
                              }}
                              loading={payMutation.isPending}
                            >
                              <CheckCircle2 size={13} className="mr-1" /> Mark Paid
                            </Button>
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </>
        )}

        {tab === 'employees' && (
          <>
            {empLoading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : empList.length === 0 ? (
              <EmptyState
                icon={UserCircle}
                title="No employees"
                description="Add society staff to manage their salaries."
                action={isAdmin ? <Button size="sm" onClick={() => setShowAddEmp(true)}><Plus size={14} className="mr-1" /> Add Employee</Button> : undefined}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {empList.map((emp: any) => (
                  <Card key={emp.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 flex-shrink-0">
                        {emp.name?.[0] ?? '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{emp.name}</p>
                        <p className="text-sm text-slate-500">{emp.designation}</p>
                        {emp.employeeCode && <p className="text-xs text-slate-400 font-mono">{emp.employeeCode}</p>}
                        <p className="mt-1 text-sm font-medium text-primary-700">₹{parseFloat(emp.baseSalary ?? 0).toLocaleString('en-IN')}/mo</p>
                      </div>
                    </div>
                    {(emp.phone || emp.email) && (
                      <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-400 space-y-0.5">
                        {emp.phone && <p>📞 {emp.phone}</p>}
                        {emp.email && <p>✉ {emp.email}</p>}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </PageContainer>
    </>
  );
}
