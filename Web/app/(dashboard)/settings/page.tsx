'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Shield, Bell, IndianRupee, ChevronRight,
  Save, Plus, X, ExternalLink, UserCog, Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import { societyApi, billingRulesApi, usersApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { initials, roleLabel } from '@/lib/utils';
import toast from 'react-hot-toast';

/* ─── helpers ───────────────────────────────────────────────────── */
const isAdmin = (role?: string) => role === 'SOCIETY_ADMIN';

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${checked ? 'bg-primary-600' : 'bg-slate-200'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function SectionDivider({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-4 pb-1">
      <span className="text-slate-400">{icon}</span>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">{title}</h3>
      <div className="h-px flex-1 bg-slate-100" />
    </div>
  );
}

/* ─── Society Details section ───────────────────────────────────── */
function SocietyDetailsSection({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['society-my'],
    queryFn: () => societyApi.getMySociety().then((r: any) => r.data ?? r),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        name: data.name ?? '',
        displayName: data.displayName ?? '',
        address: data.address ?? '',
        city: data.city ?? '',
        state: data.state ?? '',
        pincode: data.pincode ?? '',
        email: data.email ?? '',
        phone: data.phone ?? '',
      });
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => societyApi.updateMySociety(form as any),
    onSuccess: () => {
      toast.success('Society details saved');
      qc.invalidateQueries({ queryKey: ['society-my'] });
      setDirty(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to save'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
  };

  if (isLoading) return <div className="py-4"><PageSpinner /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Society Name *" value={form.name ?? ''} onChange={set('name')} disabled={!admin} />
        <Input label="Display Name" value={form.displayName ?? ''} onChange={set('displayName')} disabled={!admin} placeholder="Short name for invoices" />
      </div>
      <Input label="Address" value={form.address ?? ''} onChange={set('address')} disabled={!admin} />
      <div className="grid grid-cols-3 gap-4">
        <Input label="City" value={form.city ?? ''} onChange={set('city')} disabled={!admin} />
        <Input label="State" value={form.state ?? ''} onChange={set('state')} disabled={!admin} />
        <Input label="Pincode" value={form.pincode ?? ''} onChange={set('pincode')} disabled={!admin} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Contact Email" type="email" value={form.email ?? ''} onChange={set('email')} disabled={!admin} />
        <Input label="Contact Phone" value={form.phone ?? ''} onChange={set('phone')} disabled={!admin} />
      </div>
      {admin && (
        <div className="flex justify-end pt-1">
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!dirty} size="sm">
            <Save size={14} className="mr-1.5" /> Save Details
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Billing Config section ────────────────────────────────────── */
function BillingConfigSection({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['society-config'],
    queryFn: () => societyApi.getConfig().then((r: any) => r.data ?? r),
  });

  const [form, setForm] = useState<Record<string, any>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        currency: data.currency ?? 'INR',
        billingCycle: data.billingCycle ?? 'MONTHLY',
        billingDueDay: String(data.billingDueDay ?? 10),
        financialYearStartMonth: String(data.financialYearStartMonth ?? 4),
        gracePeriodDays: String(data.gracePeriodDays ?? 0),
        lateFeeType: data.lateFeeType ?? 'FIXED',
        lateFeeValue: String(data.lateFeeValue ?? 0),
        lateFeeMaxAmount: String(data.lateFeeMaxAmount ?? ''),
        invoicePrefix: data.invoicePrefix ?? '',
        paymentVerificationRequired: data.paymentVerificationRequired ?? false,
        allowPaymentProofUpload: data.allowPaymentProofUpload ?? true,
        showCorpusToResidents: data.showCorpusToResidents ?? false,
        showFundBalancesToResidents: data.showFundBalancesToResidents ?? false,
        showExpensesToResidents: data.showExpensesToResidents ?? false,
        publishStatementToResidents: data.publishStatementToResidents ?? false,
        publishMeetingMinutes: data.publishMeetingMinutes ?? false,
      });
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () =>
      societyApi.updateConfig({
        currency: form.currency,
        billingCycle: form.billingCycle,
        billingDueDay: Number(form.billingDueDay),
        financialYearStartMonth: Number(form.financialYearStartMonth),
        gracePeriodDays: Number(form.gracePeriodDays),
        lateFeeType: form.lateFeeType,
        lateFeeValue: Number(form.lateFeeValue),
        lateFeeMaxAmount: form.lateFeeMaxAmount ? Number(form.lateFeeMaxAmount) : undefined,
        invoicePrefix: form.invoicePrefix || undefined,
        paymentVerificationRequired: form.paymentVerificationRequired,
        allowPaymentProofUpload: form.allowPaymentProofUpload,
        showCorpusToResidents: form.showCorpusToResidents,
        showFundBalancesToResidents: form.showFundBalancesToResidents,
        showExpensesToResidents: form.showExpensesToResidents,
        publishStatementToResidents: form.publishStatementToResidents,
        publishMeetingMinutes: form.publishMeetingMinutes,
      }),
    onSuccess: () => {
      toast.success('Configuration saved');
      qc.invalidateQueries({ queryKey: ['society-config'] });
      setDirty(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to save'),
  });

  const setVal = (k: string, v: any) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const inp = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setVal(k, e.target.value);

  const MONTHS = [
    { value: '1', label: 'January' }, { value: '2', label: 'February' },
    { value: '3', label: 'March' }, { value: '4', label: 'April' },
    { value: '5', label: 'May' }, { value: '6', label: 'June' },
    { value: '7', label: 'July' }, { value: '8', label: 'August' },
    { value: '9', label: 'September' }, { value: '10', label: 'October' },
    { value: '11', label: 'November' }, { value: '12', label: 'December' },
  ];

  if (isLoading) return <div className="py-4"><PageSpinner /></div>;

  return (
    <div className="space-y-5">
      <SectionDivider title="Billing" icon={<IndianRupee size={14} />} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Input label="Currency" value={form.currency ?? ''} onChange={inp('currency')} disabled={!admin} placeholder="INR" />
        <Select
          label="Billing Cycle"
          value={form.billingCycle ?? 'MONTHLY'}
          onChange={(e) => setVal('billingCycle', e.target.value)}
          disabled={!admin}
          options={[
            { value: 'MONTHLY', label: 'Monthly' },
            { value: 'QUARTERLY', label: 'Quarterly' },
            { value: 'HALF_YEARLY', label: 'Half-Yearly' },
            { value: 'YEARLY', label: 'Yearly' },
          ]}
        />
        <Input label="Due Day of Month" type="number" value={form.billingDueDay ?? ''} onChange={inp('billingDueDay')} disabled={!admin} placeholder="10" />
        <Select
          label="Financial Year Start"
          value={form.financialYearStartMonth ?? '4'}
          onChange={(e) => setVal('financialYearStartMonth', e.target.value)}
          disabled={!admin}
          options={MONTHS}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Input label="Invoice Prefix" value={form.invoicePrefix ?? ''} onChange={inp('invoicePrefix')} disabled={!admin} placeholder="INV" />
        <Input label="Grace Period (days)" type="number" value={form.gracePeriodDays ?? ''} onChange={inp('gracePeriodDays')} disabled={!admin} />
      </div>

      <SectionDivider title="Late Fees" icon={<IndianRupee size={14} />} />
      <div className="grid grid-cols-3 gap-4">
        <Select
          label="Late Fee Type"
          value={form.lateFeeType ?? 'FIXED'}
          onChange={(e) => setVal('lateFeeType', e.target.value)}
          disabled={!admin}
          options={[
            { value: 'FIXED', label: 'Fixed Amount' },
            { value: 'PERCENTAGE', label: 'Percentage' },
          ]}
        />
        <Input
          label={form.lateFeeType === 'PERCENTAGE' ? 'Rate (%)' : 'Amount (₹)'}
          type="number"
          value={form.lateFeeValue ?? ''}
          onChange={inp('lateFeeValue')}
          disabled={!admin}
        />
        <Input label="Max Late Fee (₹)" type="number" value={form.lateFeeMaxAmount ?? ''} onChange={inp('lateFeeMaxAmount')} disabled={!admin} placeholder="Optional cap" />
      </div>

      <SectionDivider title="Transparency" icon={<Shield size={14} />} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { key: 'paymentVerificationRequired', label: 'Require payment verification', desc: 'Admin must approve each payment before it is accepted' },
          { key: 'allowPaymentProofUpload', label: 'Allow payment proof uploads', desc: 'Residents can upload screenshots with their payment' },
          { key: 'showCorpusToResidents', label: 'Show corpus balance to residents' },
          { key: 'showFundBalancesToResidents', label: 'Show fund balances to residents' },
          { key: 'showExpensesToResidents', label: 'Show expenses to residents' },
          { key: 'publishStatementToResidents', label: 'Publish monthly statement to residents' },
          { key: 'publishMeetingMinutes', label: 'Publish meeting minutes' },
        ].map(({ key, label, desc }) => (
          <div key={key} className="flex items-start justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{label}</p>
              {desc && <p className="text-xs text-slate-500">{desc}</p>}
            </div>
            <Toggle
              checked={!!form[key]}
              onChange={(v) => setVal(key, v)}
              disabled={!admin}
            />
          </div>
        ))}
      </div>

      {admin && (
        <div className="flex justify-end pt-1">
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!dirty} size="sm">
            <Save size={14} className="mr-1.5" /> Save Configuration
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Add Billing Rule Modal ────────────────────────────────────── */
function AddBillingRuleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    description: '',
    calculationType: 'PER_FLAT',
    effectiveFrom: new Date().toISOString().split('T')[0],
    effectiveTo: '',
    priority: '1',
  });

  const mutation = useMutation({
    mutationFn: () =>
      billingRulesApi.create({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        calculationType: form.calculationType as any,
        effectiveFrom: new Date(form.effectiveFrom).toISOString(),
        effectiveTo: form.effectiveTo ? new Date(form.effectiveTo).toISOString() : undefined,
        priority: form.priority ? Number(form.priority) : undefined,
      }),
    onSuccess: () => {
      toast.success('Billing rule created');
      qc.invalidateQueries({ queryKey: ['billing-rules'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create rule'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Billing Rule</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Input label="Rule Name *" placeholder="Standard Maintenance" value={form.name} onChange={set('name')} />
          <Input label="Description" placeholder="Monthly maintenance charge per flat" value={form.description} onChange={set('description')} />
          <Select
            label="Calculation Type"
            value={form.calculationType}
            onChange={set('calculationType')}
            options={[
              { value: 'PER_FLAT', label: 'Per Flat (fixed amount)' },
              { value: 'PER_SQ_FT', label: 'Per Square Foot' },
              { value: 'EQUAL_SPLIT', label: 'Equal Split' },
              { value: 'CUSTOM', label: 'Custom Formula' },
            ]}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Effective From *" type="date" value={form.effectiveFrom} onChange={set('effectiveFrom')} />
            <Input label="Effective To (optional)" type="date" value={form.effectiveTo} onChange={set('effectiveTo')} />
          </div>
          <Input label="Priority" type="number" placeholder="1 = highest" value={form.priority} onChange={set('priority')} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.name.trim()}>
            Create Rule
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Billing Rules section ─────────────────────────────────────── */
function BillingRulesSection({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['billing-rules'],
    queryFn: () => billingRulesApi.list().then((r: any) => r.data ?? r),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      billingRulesApi.toggle(id, isActive),
    onSuccess: () => {
      toast.success('Rule updated');
      qc.invalidateQueries({ queryKey: ['billing-rules'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update'),
  });

  const rules: any[] = Array.isArray(data) ? data : (data?.data ?? []);

  if (isLoading) return <div className="py-4"><PageSpinner /></div>;

  return (
    <>
      {showAdd && <AddBillingRuleModal onClose={() => setShowAdd(false)} />}
      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
            <IndianRupee size={24} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">No billing rules yet</p>
            {admin && (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-2 text-xs font-medium text-primary-600 hover:underline"
              >
                Create the first rule
              </button>
            )}
          </div>
        ) : (
          rules.map((rule: any) => (
            <div key={rule.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">{rule.name}</p>
                  <Badge variant={rule.isActive ? 'success' : 'default'}>
                    {rule.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {rule.description && <p className="text-xs text-slate-500">{rule.description}</p>}
                <p className="text-xs text-slate-400 mt-0.5">
                  {rule.calculationType?.replace(/_/g, ' ')}
                  {rule.effectiveFrom ? ` · From ${new Date(rule.effectiveFrom).toLocaleDateString('en-IN')}` : ''}
                  {rule.effectiveTo ? ` to ${new Date(rule.effectiveTo).toLocaleDateString('en-IN')}` : ''}
                </p>
              </div>
              {admin && (
                <Toggle
                  checked={!!rule.isActive}
                  onChange={(v) => toggleMutation.mutate({ id: rule.id, isActive: v })}
                  disabled={toggleMutation.isPending}
                />
              )}
            </div>
          ))
        )}
        {admin && rules.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} className="mr-1.5" /> Add Rule
          </Button>
        )}
      </div>
    </>
  );
}

/* ─── Roles & Permissions section ──────────────────────────────── */
const ROLE_OPTIONS = [
  { value: 'SOCIETY_ADMIN', label: 'Society Admin' },
  { value: 'SOCIETY_ACCOUNTANT', label: 'Accountant' },
  { value: 'SOCIETY_STAFF', label: 'Staff' },
  { value: 'RESIDENT', label: 'Resident' },
];

const roleColor: Record<string, string> = {
  SOCIETY_ADMIN: 'bg-red-50 text-red-700',
  SOCIETY_ACCOUNTANT: 'bg-amber-50 text-amber-700',
  SOCIETY_STAFF: 'bg-blue-50 text-blue-700',
  RESIDENT: 'bg-green-50 text-green-700',
};

function RolesSection({ admin }: { admin: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['society-members'],
    queryFn: () => usersApi.listSociety({ limit: 100 }).then((r: any) => r.data ?? r),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      usersApi.addMember({ userId, role }),
    onSuccess: () => {
      toast.success('Role updated');
      qc.invalidateQueries({ queryKey: ['society-members'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update role'),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => usersApi.removeMember(userId),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['society-members'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove member'),
  });

  const members: any[] = Array.isArray(data) ? data : (data?.data ?? []);

  if (isLoading) return <div className="py-4"><PageSpinner /></div>;

  if (members.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
        <Shield size={24} className="mx-auto mb-2 text-slate-300" />
        <p className="text-sm text-slate-500">No members found</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden">
      {members.map((m: any) => {
        const role = m.memberships?.[0]?.role ?? 'RESIDENT';
        const colorClass = roleColor[role] ?? 'bg-slate-100 text-slate-600';
        return (
          <div key={m.id} className="flex items-center gap-4 px-4 py-3">
            {/* Avatar */}
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
              {initials(`${m.firstName} ${m.lastName}`)}
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{m.firstName} {m.lastName}</p>
              <p className="text-xs text-slate-500 truncate">{m.email}</p>
            </div>
            {/* Role */}
            {admin ? (
              <select
                value={role}
                onChange={(e) => changeRoleMutation.mutate({ userId: m.id, role: e.target.value })}
                disabled={changeRoleMutation.isPending}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
                {ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role.replace(/_/g, ' ')}
              </span>
            )}
            {/* Remove */}
            {admin && (
              <button
                onClick={() => removeMutation.mutate(m.id)}
                disabled={removeMutation.isPending}
                className="rounded-md p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="Remove from society"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const admin = isAdmin(user?.currentRole);

  return (
    <>
      <Header title="Settings" subtitle="Account & society configuration" />
      <PageContainer className="space-y-6">

        {/* My Account */}
        <Card padding="lg">
          <CardHeader>
            <CardTitle>My Account</CardTitle>
          </CardHeader>
          <div className="flex items-center gap-5">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xl font-bold text-primary-700">
              {user ? initials(user.displayName) : '?'}
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">{user?.displayName}</p>
              <p className="text-sm text-slate-500">{user?.email}</p>
              {user?.phone && <p className="text-sm text-slate-500">{user.phone}</p>}
              <span className="mt-1 inline-block rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                {roleLabel(user?.currentRole ?? '')}
              </span>
            </div>
          </div>
        </Card>

        {/* Society Settings */}
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Society Settings</CardTitle>
            {!admin && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">View only</span>
            )}
          </CardHeader>
          <SocietyDetailsSection admin={admin} />
          <BillingConfigSection admin={admin} />
        </Card>

        {/* Residents & Flats — link out to dedicated page */}
        <Card padding="lg" className="cursor-pointer hover:border-primary-200 transition-colors" onClick={() => router.push('/flats')}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-primary-600" />
              <CardTitle>Residents & Flats</CardTitle>
            </div>
            <ChevronRight size={18} className="text-slate-400" />
          </CardHeader>
          <p className="text-sm text-slate-500">Manage buildings, flat assignments, and building structure.</p>
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-600">
            <ExternalLink size={12} /> Go to Flats management
          </p>
        </Card>

        {/* Billing Rules */}
        <Card padding="lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <IndianRupee size={18} className="text-primary-600" />
              <CardTitle>Billing Rules</CardTitle>
            </div>
          </CardHeader>
          <p className="mb-4 text-sm text-slate-500">
            Define how maintenance charges are calculated for each billing period.
          </p>
          <BillingRulesSection admin={admin} />
        </Card>

        {/* Roles & Permissions */}
        <Card padding="lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserCog size={18} className="text-primary-600" />
              <CardTitle>Roles & Permissions</CardTitle>
            </div>
            {!admin && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">View only</span>
            )}
          </CardHeader>
          <p className="mb-4 text-sm text-slate-500">
            Society members and their access roles.
            {admin && ' Use the dropdown to change a member\'s role, or remove them from the society.'}
          </p>
          <RolesSection admin={admin} />
        </Card>

        {/* Notifications — link to dedicated page */}
        <Card padding="lg" className="cursor-pointer hover:border-primary-200 transition-colors" onClick={() => router.push('/notifications')}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-primary-600" />
              <CardTitle>Notifications</CardTitle>
            </div>
            <ChevronRight size={18} className="text-slate-400" />
          </CardHeader>
          <p className="text-sm text-slate-500">View and manage society notifications. Admins can send announcements to all members.</p>
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-600">
            <ExternalLink size={12} /> Go to Notifications
          </p>
        </Card>

      </PageContainer>
    </>
  );
}
