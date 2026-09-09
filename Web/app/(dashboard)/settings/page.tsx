'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Shield, Bell, IndianRupee, ChevronRight,
  Save, Plus, X, ExternalLink, UserCog, Trash2,
  Sparkles, Lock, CheckCircle2, Key, Copy, RefreshCw, Share2,
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
// Admin = SOCIETY_ADMIN in current society, OR platform admin (full access)
const isSocietyAdmin = (membershipRole?: string, isPlatformAdmin?: boolean) =>
  membershipRole === 'SOCIETY_ADMIN' || !!isPlatformAdmin;

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
        showAccountBalancesToResidents: data.showAccountBalancesToResidents ?? false,
        showExpensesToResidents: data.showExpensesToResidents ?? false,
        publishStatementToResidents: data.publishStatementToResidents ?? false,
        publishMeetingMinutes: data.publishMeetingMinutes ?? false,
        upiId: (data.additionalConfig as any)?.upiId ?? '',
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
        showAccountBalancesToResidents: form.showAccountBalancesToResidents,
        showExpensesToResidents: form.showExpensesToResidents,
        publishStatementToResidents: form.publishStatementToResidents,
        publishMeetingMinutes: form.publishMeetingMinutes,
        upiId: form.upiId || undefined,
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
          // A "Show corpus balance to residents" switch used to sit here and was
          // read by nothing — an admin turning it off believed corpus was hidden
          // while residents could still see it. Funds are shown or hidden one at
          // a time on the fund itself (Accounts & Funds), which is now the only
          // place that choice is offered.
          {
            key: 'showAccountBalancesToResidents',
            label: 'Show total bank balance to residents',
            desc: 'Each fund is shown or hidden separately, under Accounts & Funds',
          },
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

      <SectionDivider title="UPI Payment" icon={<IndianRupee size={14} />} />
      <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
        <p className="mb-3 text-xs text-emerald-700">
          Set your society&apos;s UPI ID so residents can pay directly via PhonePe, GPay, Paytm, or BHIM — no payment gateway fees.
        </p>
        <Input
          label="Society UPI ID"
          placeholder="societyname@okicici"
          value={form.upiId ?? ''}
          onChange={inp('upiId')}
          disabled={!admin}
        />
        {form.upiId && (
          <p className="mt-2 text-[11px] text-emerald-600">
            Residents will see a &ldquo;Pay via UPI&rdquo; button with a deep link to open their UPI app automatically.
          </p>
        )}
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
    calculationType: 'EQUAL_PER_FLAT',
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
            /* These must match the CalculationType enum in schema.prisma exactly —
               the DTO validates with @IsEnum, so any other value is a 400. */
            options={[
              { value: 'EQUAL_PER_FLAT', label: 'Equal per flat' },
              { value: 'AREA_BASED', label: 'Area based (per sq ft)' },
              { value: 'PER_PERSON', label: 'Per person' },
              { value: 'WATER_USAGE_BASED', label: 'Water usage based' },
              { value: 'PERCENTAGE_BASED', label: 'Percentage based' },
              { value: 'HYBRID', label: 'Hybrid' },
              { value: 'FIXED_CUSTOM', label: 'Fixed custom' },
              { value: 'CUSTOM_FORMULA', label: 'Custom formula' },
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

/* ─── Resident Invite Code section ─────────────────────────────── */
function InviteCodeSection() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['web-join-code'],
    queryFn: () => societyApi.getJoinCode().then((r) => r.data),
  });

  const regenMutation = useMutation({
    mutationFn: () => societyApi.regenerateJoinCode(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['web-join-code'] });
      toast.success('New invite code generated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to regenerate'),
  });

  const code = data?.joinCode ?? '';
  const generatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    const msg =
      `🏢 Join our society on NG Home!\n\n` +
      `Tap "Have an invite code? Join your society" on the NG Home login screen and enter:\n\n` +
      `${code}\n\n` +
      `Download NG Home and create your account in minutes.`;
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener');
  };

  const handleRegenerate = () => {
    if (!confirm('The current code will stop working immediately. Residents who haven\'t joined yet will need the new code. Continue?')) return;
    regenMutation.mutate();
  };

  if (isLoading) return <div className="py-2 text-sm text-slate-500">Loading invite code…</div>;

  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary-200 bg-white">
          <Key size={16} className="text-primary-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Resident Invite Code</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Share with residents — they enter this code on the NG Home mobile app to join your society
          </p>
        </div>
      </div>

      {/* Code display */}
      <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-4">
        <span className="font-mono text-3xl font-bold tracking-[0.2em] text-slate-900 select-all">
          {code || '—'}
        </span>
      </div>
      {generatedAt && (
        <p className="text-center text-xs text-slate-400">Generated {generatedAt}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={handleCopy}
          disabled={!code}
        >
          {copied ? <CheckCircle2 size={14} className="mr-1.5 text-green-600" /> : <Copy size={14} className="mr-1.5" />}
          {copied ? 'Copied!' : 'Copy Code'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1 !text-green-700 !border-green-200 !bg-green-50 hover:!bg-green-100"
          onClick={handleShare}
          disabled={!code}
        >
          <Share2 size={14} className="mr-1.5" />
          Share via WhatsApp
        </Button>
      </div>

      {/* Regenerate */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-400">Regenerating invalidates the current code immediately</p>
        <button
          onClick={handleRegenerate}
          disabled={regenMutation.isPending || !code}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-40"
        >
          <RefreshCw size={12} className={regenMutation.isPending ? 'animate-spin' : ''} />
          {regenMutation.isPending ? 'Regenerating…' : 'Regenerate code'}
        </button>
      </div>
    </div>
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

/* ─── Platform Plan Section (Platform Admin only) ───────────────── */
/*
 * This section is ONLY visible to PLATFORM_ADMIN users. Societies never
 * see it. It lets the platform operator define whether NG Home is free or
 * subscription-gated, and pre-configure future pricing tiers — without
 * activating billing until the switch is flipped.
 *
 * Current state: FREE for everyone. The toggle is OFF and cannot be turned
 * on until the backend subscription API is wired up — at which point the
 * "Activate" button becomes the real entry point.
 */

const TIERS = [
  {
    key: 'FREE',
    name: 'Free',
    price: '₹0 / mo',
    features: ['Up to 50 flats', 'Billing & maintenance', 'Water readings', 'Community'],
    color: 'border-slate-200 bg-slate-50',
    badgeColor: 'bg-slate-100 text-slate-600',
    current: true,
  },
  {
    key: 'STARTER',
    name: 'Starter',
    price: '₹299 / mo',
    features: ['Up to 150 flats', 'All Free features', 'Reports & PDF', 'WhatsApp reminders'],
    color: 'border-primary-200 bg-primary-50',
    badgeColor: 'bg-primary-100 text-primary-700',
    current: false,
  },
  {
    key: 'PROFESSIONAL',
    name: 'Professional',
    price: '₹799 / mo',
    features: ['Unlimited flats', 'All Starter features', 'Priority support', 'Custom branding'],
    color: 'border-violet-200 bg-violet-50',
    badgeColor: 'bg-violet-100 text-violet-700',
    current: false,
  },
] as const;

function PlatformPlanSection() {
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);

  return (
    <Card padding="lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-violet-500" />
          <CardTitle>Platform &amp; Pricing</CardTitle>
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            Platform Admin
          </span>
        </div>
      </CardHeader>

      {/* Current status banner */}
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-green-600" />
        <div>
          <p className="text-sm font-semibold text-green-800">Free for all societies — no subscription required</p>
          <p className="text-xs text-green-700 mt-0.5">
            NG Home is currently free on both web and mobile. Enable subscription billing here when you&apos;re ready to monetise.
          </p>
        </div>
      </div>

      {/* Subscription gate toggle */}
      <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Enable subscription gating</p>
          <p className="text-xs text-slate-500 mt-0.5">
            When ON, societies must be on a paid plan to access premium features.
            <span className="ml-1 font-medium text-amber-600">Backend billing API not yet connected — activating has no effect until wired.</span>
          </p>
        </div>
        <Toggle
          checked={subscriptionEnabled}
          onChange={setSubscriptionEnabled}
          disabled={true /* remove when backend is ready */}
        />
      </div>

      {/* Pricing tiers preview */}
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Pricing tiers (preview — not yet active)</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            className={`rounded-xl border-2 p-4 ${tier.color} relative`}
          >
            {tier.current && (
              <span className="absolute right-3 top-3 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
                Active
              </span>
            )}
            <p className="text-base font-bold text-slate-900">{tier.name}</p>
            <p className="mt-0.5 text-lg font-extrabold text-slate-800 tabular-nums">{tier.price}</p>
            <ul className="mt-3 space-y-1.5">
              {tier.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <CheckCircle2 size={12} className="flex-shrink-0 text-slate-400" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Locked notice */}
      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Lock size={12} />
        Pricing activation is locked until the subscription API is ready. Adjust tier names and prices here freely — they won&apos;t go live until you remove the <code className="text-slate-500">disabled</code> flag.
      </div>
    </Card>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { user, activeMembership } = useAuth();
  const router = useRouter();
  const admin = isSocietyAdmin(activeMembership?.role, user?.isPlatformAdmin);

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

        {/* Resident Invite Code */}
        {admin && (
          <Card padding="lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Key size={18} className="text-primary-600" />
                <CardTitle>Resident Invite Code</CardTitle>
              </div>
            </CardHeader>
            <p className="mb-4 text-sm text-slate-500">
              Residents use this code on the NG Home mobile app to self-register and join your society.
            </p>
            <InviteCodeSection />
          </Card>
        )}

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

        {/* Platform & Pricing — platform admin only */}
        {user?.isPlatformAdmin && <PlatformPlanSection />}

      </PageContainer>
    </>
  );
}
