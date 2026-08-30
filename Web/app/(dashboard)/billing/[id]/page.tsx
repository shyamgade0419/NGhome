'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Download, FileText, Printer, RefreshCw,
  Send, CheckCircle2, Lock, Droplets, MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { billingApi, waterApi } from '@/lib/api/endpoints';
import { billingPeriodLabel } from '@/lib/types';
import type { MaintenanceBill } from '@/lib/types';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, billStatusBadge } from '@/components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';
import { can } from '@/lib/permissions';
import toast from 'react-hot-toast';

/* ── WhatsApp helpers ──────────────────────────────────────────
   No API needed — wa.me links open WhatsApp with a pre-filled
   message. On mobile they open the app; on desktop they open
   WhatsApp Web. Admin chooses which contact or group to send to.
──────────────────────────────────────────────────────────────── */
function buildBillMessage(bill: MaintenanceBill, period: any, societyName = 'Society'): string {
  const MONTHS = ['','January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const month = `${MONTHS[period.periodMonth] ?? ''} ${period.periodYear}`;
  const due   = period.dueDate ? new Date(period.dueDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '';
  const total = parseFloat(bill.totalAmount);
  const pending = parseFloat(bill.pendingAmount ?? '0');
  const water = parseFloat(bill.waterCharges ?? '0');

  const lines: string[] = [
    `🏢 *${societyName} — ${month} Maintenance*`,
    '',
    `Flat: *${bill.flatCode ?? bill.flat?.flatCode ?? ''}*  |  Invoice: ${bill.invoiceNumber ?? ''}`,
    `Due Date: *${due}*`,
    '',
    `💰 Total Amount: *₹${total.toLocaleString('en-IN')}*`,
  ];

  if (water > 0) {
    lines.push(`   • Maintenance: ₹${parseFloat(bill.baseAmount ?? '0').toLocaleString('en-IN')}`);
    lines.push(`   • Water Charges: ₹${water.toLocaleString('en-IN')}`);
  }

  if (bill.isPaid) {
    lines.push('', '✅ *Payment received — Thank you!*');
  } else if (pending > 0) {
    lines.push('', `⚠️ *Balance Due: ₹${pending.toLocaleString('en-IN')}*`);
    lines.push(`Please pay before ${due} to avoid late fees.`);
  }

  lines.push('', `_${societyName} Management_`);
  return lines.join('\n');
}

function buildGroupMessage(period: any, bills: MaintenanceBill[], societyName = 'Society'): string {
  const MONTHS = ['','January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const month = `${MONTHS[period.periodMonth] ?? ''} ${period.periodYear}`;
  const due   = period.dueDate ? new Date(period.dueDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '';
  const unpaid = bills.filter(b => !b.isPaid && b.isPublished).length;
  const total  = bills.length;

  const lines: string[] = [
    `🏢 *${societyName} — ${month} Maintenance*`,
    '',
    'Dear Residents,',
    '',
    `Your maintenance bills for *${month}* are now published.`,
    '',
    `📅 *Due Date: ${due}*`,
  ];

  if (unpaid > 0) {
    lines.push('', `⚠️ ${unpaid} of ${total} flats are yet to pay.`);
  }

  lines.push(
    '',
    '📱 Log in to the NG Home portal to view your individual bill and payment details.',
    '',
    'For queries, contact the society admin.',
    '',
    `_${societyName} Management_`,
  );
  return lines.join('\n');
}

/**
 * Open WhatsApp with a pre-filled message.
 * If phone is provided, opens directly in that contact's chat.
 * Otherwise opens WhatsApp Web / app so admin picks the contact.
 *
 * Phone format: accepts "+91 98765 43210" or "9876543210" — we strip
 * non-digits and prepend 91 (India) if no country code present.
 */
function openWhatsApp(message: string, phone?: string | null): void {
  let url: string;
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const e164 = digits.length === 10 ? `91${digits}` : digits;
    url = `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;
  } else {
    url = `https://wa.me/?text=${encodeURIComponent(message)}`;
  }
  window.open(url, '_blank', 'noopener');
}

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function BillingPeriodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { user, activeMembership } = useAuth();
  const isAdmin = can.manageBilling(activeMembership?.role, user?.isPlatformAdmin);

  const [activeTab, setActiveTab] = useState<'bills' | 'report' | 'water'>('bills');
  const [remindAllOpen, setRemindAllOpen] = useState(false);

  /* Period + bills */
  const { data: period, isLoading: periodLoading } = useQuery({
    queryKey: ['billing-period', id],
    queryFn: () => billingApi.getPeriod(id).then((r) => r.data),
  });

  const { data: billsData, isLoading: billsLoading } = useQuery({
    queryKey: ['billing-period-bills', id],
    queryFn: () => billingApi.listBills(id, { limit: 200 }).then((r) => r.data),
    enabled: !!period,
  });

  /* Full report (for holistic view) */
  const { data: reportData, isLoading: reportLoading } = useQuery({
    queryKey: ['billing-period-report', id],
    queryFn: () => billingApi.getPeriodReport(id).then((r: any) => r.data ?? r),
    enabled: activeTab === 'report' && !!period,
  });

  /* Water summary */
  const { data: waterSummary, isLoading: waterLoading } = useQuery({
    queryKey: ['water-period-summary', id],
    queryFn: () => waterApi.getPeriodSummary(id).then((r: any) => r.data ?? r),
    enabled: activeTab === 'water' && !!period,
  });

  /* Generate bills */
  const generateMutation = useMutation({
    mutationFn: () => billingApi.generateBills(id).then((r) => r.data),
    onSuccess: (data: any) => {
      toast.success(`${data.billsGenerated ?? data.generated ?? 'Bills'} bills generated`);
      qc.invalidateQueries({ queryKey: ['billing-period', id] });
      qc.invalidateQueries({ queryKey: ['billing-period-bills', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to generate bills'),
  });

  /* Publish period */
  const publishMutation = useMutation({
    mutationFn: () => billingApi.publishPeriod(id).then((r) => r.data),
    onSuccess: () => {
      toast.success('Bills published to residents!');
      qc.invalidateQueries({ queryKey: ['billing-period', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to publish'),
  });

  /* Close period */
  const closeMutation = useMutation({
    mutationFn: () => billingApi.closePeriod(id).then((r) => r.data),
    onSuccess: () => {
      toast.success('Period closed');
      qc.invalidateQueries({ queryKey: ['billing-period', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to close period'),
  });

  const handleDownload = () => {
    // Open print dialog to save as PDF
    window.print();
  };

  if (periodLoading) return <PageSpinner />;
  if (!period) return <div className="p-8 text-slate-500">Billing period not found.</div>;

  const bills: MaintenanceBill[] = billsData?.data ?? [];
  const unpaidBills = bills.filter((b) => b.isPublished && !b.isPaid);
  const status = period.status;
  const canGenerate = isAdmin && ['DRAFT', 'CALCULATED'].includes(status);
  const canPublish = isAdmin && ['CALCULATED', 'REVIEW'].includes(status);
  const canClose = isAdmin && ['PUBLISHED', 'PARTIALLY_PAID', 'PAID'].includes(status);

  const reportBills: any[] = reportData?.bills ?? [];

  return (
    <>
      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {reportData?.society?.displayName ?? reportData?.society?.name ?? 'Society'}
        </h1>
        <p className="text-sm text-slate-600">{reportData?.society?.address}</p>
        <h2 className="mt-4 text-xl font-semibold">
          Monthly Maintenance Statement — {MONTH_NAMES[period.periodMonth]} {period.periodYear}
        </h2>
        <p className="text-sm text-slate-500">
          Period: {formatDate(period.startDate)} – {formatDate(period.endDate)} · Due: {formatDate(period.dueDate)}
        </p>
      </div>

      <div className="print:hidden">
        <Header
          title={billingPeriodLabel(period)}
          subtitle="Billing period detail"
          actions={
            <div className="flex gap-2">
              {isAdmin && (
                <>
                  {canGenerate && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => generateMutation.mutate()}
                      loading={generateMutation.isPending}
                    >
                      <RefreshCw size={13} className="mr-1.5" />
                      {bills.length > 0 ? 'Re-generate' : 'Generate Bills'}
                    </Button>
                  )}
                  {canPublish && (
                    <Button
                      size="sm"
                      onClick={() => {
                        if (window.confirm('Publish bills to all residents?')) publishMutation.mutate();
                      }}
                      loading={publishMutation.isPending}
                    >
                      <Send size={13} className="mr-1.5" /> Publish
                    </Button>
                  )}
                  {canClose && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (window.confirm('Close this billing period? This cannot be undone.')) closeMutation.mutate();
                      }}
                      loading={closeMutation.isPending}
                    >
                      <Lock size={13} className="mr-1.5" /> Close Period
                    </Button>
                  )}
                </>
              )}
              {isAdmin && status === 'PUBLISHED' && bills.length > 0 && (
                <>
                  {/* Remind All — opens direct wa.me/PHONE links per unpaid resident */}
                  {unpaidBills.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRemindAllOpen(true)}
                      title={`Send individual WhatsApp reminders to ${unpaidBills.length} unpaid residents`}
                    >
                      <MessageSquare size={13} className="mr-1.5 text-green-600" />
                      Remind All ({unpaidBills.length})
                    </Button>
                  )}
                  {/* Group broadcast — one message for the society WhatsApp group */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openWhatsApp(buildGroupMessage(period, bills))}
                    title="Open WhatsApp with a pre-filled group message"
                  >
                    <MessageSquare size={13} className="mr-1.5 text-green-600" />
                    Group Message
                  </Button>
                </>
              )}
              {bills.length > 0 && (
                <Button size="sm" variant="secondary" onClick={handleDownload}>
                  <Download size={13} className="mr-1.5" /> Download PDF
                </Button>
              )}
              <Link href="/billing">
                <Button size="sm" variant="secondary">
                  <ArrowLeft size={13} className="mr-1.5" /> Back
                </Button>
              </Link>
            </div>
          }
        />
      </div>

      <PageContainer className="space-y-6 print:pt-0">
        {/* Period summary cards */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card padding="lg">
            <CardHeader>
              <CardTitle>Period Details</CardTitle>
              <Badge variant={billStatusBadge(period.status)}>{period.status.replace(/_/g, ' ')}</Badge>
            </CardHeader>
            <dl className="space-y-2.5 text-sm">
              {[
                { label: 'Period', value: billingPeriodLabel(period) },
                { label: 'Start Date', value: formatDate(period.startDate) },
                { label: 'End Date', value: formatDate(period.endDate) },
                { label: 'Due Date', value: formatDate(period.dueDate) },
                ...(period.publishedAt ? [{ label: 'Published', value: formatDate(period.publishedAt) }] : []),
                ...(period.closedAt ? [{ label: 'Closed', value: formatDate(period.closedAt) }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card padding="lg">
            <CardHeader><CardTitle>Collection Summary</CardTitle></CardHeader>
            <dl className="space-y-2.5 text-sm">
              {[
                { label: 'Total Billed', value: formatCurrency(period.totalBilled), cls: '' },
                { label: 'Collected', value: formatCurrency(period.totalCollected), cls: 'text-green-700' },
                { label: 'Pending', value: formatCurrency(period.totalPending), cls: parseFloat(period.totalPending) > 0 ? 'text-red-600' : 'text-green-700' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className={cn('text-lg font-bold', cls || 'text-slate-900')}>{value}</dd>
                </div>
              ))}
              {bills.length > 0 && (
                <div className="pt-1 border-t border-slate-100">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Collection Rate</dt>
                    <dd className="font-semibold text-slate-900">
                      {parseFloat(period.totalBilled) > 0
                        ? `${((parseFloat(period.totalCollected) / parseFloat(period.totalBilled)) * 100).toFixed(1)}%`
                        : '—'}
                    </dd>
                  </div>
                </div>
              )}
            </dl>
          </Card>

          <Card padding="lg">
            <CardHeader><CardTitle>Bills Summary</CardTitle></CardHeader>
            <dl className="space-y-2.5 text-sm">
              {[
                { label: 'Total Flats', value: String(bills.length) },
                { label: 'Paid', value: String(bills.filter((b) => b.isPaid).length) },
                { label: 'Partially Paid / Unpaid', value: String(bills.filter((b) => !b.isPaid && b.isPublished).length) },
                { label: 'Draft', value: String(bills.filter((b) => !b.isPublished).length) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        {/* Tabs */}
        <div className="print:hidden flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
          {([
            { id: 'bills', label: 'All Bills', icon: FileText },
            { id: 'report', label: 'Holistic Report', icon: Printer },
            { id: 'water', label: 'Water Summary', icon: Droplets },
          ] as const).map(({ id: t, label, icon: Icon }) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                activeTab === t ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Bills list tab */}
        {(activeTab === 'bills') && (
          <Card padding="none" className="print:hidden">
            {billsLoading ? (
              <div className="flex justify-center py-12 text-sm text-slate-400">Loading bills…</div>
            ) : !bills.length ? (
              <div className="py-12 text-center text-sm text-slate-400">
                No bills generated yet. Click &ldquo;Generate Bills&rdquo; above.
              </div>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Invoice #</Th>
                    <Th>Flat</Th>
                    <Th>Base</Th>
                    <Th>Water</Th>
                    <Th>Total</Th>
                    <Th>Paid</Th>
                    <Th>Pending</Th>
                    <Th>Status</Th>
                    {isAdmin && <Th></Th>}
                  </Tr>
                </Thead>
                <Tbody>
                  {bills.map((bill) => (
                    <Tr key={bill.id}>
                      <Td className="font-mono text-xs">{bill.invoiceNumber}</Td>
                      <Td className="font-semibold">{bill.flatCode}</Td>
                      <Td className="tabular-nums">{formatCurrency(bill.baseAmount ?? '0')}</Td>
                      <Td className="tabular-nums text-blue-600">
                        {parseFloat(bill.waterCharges ?? '0') > 0 ? formatCurrency(bill.waterCharges ?? '0') : '—'}
                      </Td>
                      <Td className="font-semibold tabular-nums">{formatCurrency(bill.totalAmount)}</Td>
                      <Td className="text-green-600 tabular-nums">{formatCurrency(bill.paidAmount)}</Td>
                      <Td className={cn('tabular-nums', parseFloat(bill.pendingAmount) > 0 ? 'text-red-600 font-semibold' : '')}>
                        {formatCurrency(bill.pendingAmount)}
                      </Td>
                      <Td>
                        <Badge variant={bill.isPaid ? 'success' : bill.isPublished ? 'warning' : 'muted'}>
                          {bill.isPaid ? 'Paid' : bill.isPublished ? 'Unpaid' : 'Draft'}
                        </Badge>
                      </Td>
                      {isAdmin && (
                        <Td>
                          {bill.isPublished && !bill.isPaid && (
                            <button
                              onClick={() => openWhatsApp(
                                buildBillMessage(bill, period),
                                bill.residentPhone,
                              )}
                              title={
                                bill.residentPhone
                                  ? `WhatsApp Flat ${bill.flatCode} directly`
                                  : `WhatsApp reminder for Flat ${bill.flatCode}`
                              }
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 transition-colors"
                            >
                              <MessageSquare size={13} />
                              <span className="hidden sm:inline">Remind</span>
                            </button>
                          )}
                        </Td>
                      )}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        )}

        {/* Holistic Report tab (also the print view) */}
        {(activeTab === 'report' || true) && (
          <div className={activeTab === 'report' ? '' : 'hidden print:block'}>
            {activeTab === 'report' && reportLoading && <PageSpinner />}
            {(activeTab === 'report' ? !reportLoading : true) && reportBills.length === 0 && activeTab === 'report' && (
              <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
                Generate bills first to view the holistic report.
              </div>
            )}
            {reportBills.length > 0 && (
              <div className="space-y-4">
                {/* Print notice */}
                <div className="print:hidden rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 flex items-center gap-2">
                  <Printer size={14} />
                  Click <strong>Download PDF</strong> above to save this report. Your browser will open a print dialog — choose &ldquo;Save as PDF&rdquo;.
                </div>

                {/* Society-level summary */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {[
                    { label: 'Total Billed', value: formatCurrency(period.totalBilled) },
                    { label: 'Total Collected', value: formatCurrency(period.totalCollected) },
                    { label: 'Outstanding', value: formatCurrency(period.totalPending) },
                    { label: 'Flats', value: String(reportBills.length) },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>

                {/* All flats table */}
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Flat-wise Maintenance — {MONTH_NAMES[period.periodMonth]} {period.periodYear}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice #</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Flat</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Base</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Water</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Adjustments</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Total</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Paid</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportBills.map((bill: any) => (
                          <tr key={bill.id} className="hover:bg-slate-50 print:hover:bg-transparent">
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{bill.invoiceNumber}</td>
                            <td className="px-4 py-2.5 font-semibold text-slate-900">{bill.flatCode}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(bill.baseAmount ?? '0')}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-blue-600">
                              {parseFloat(bill.waterCharges ?? '0') > 0 ? formatCurrency(bill.waterCharges ?? '0') : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {parseFloat(bill.adjustments) !== 0 ? formatCurrency(bill.adjustments) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatCurrency(bill.totalAmount)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-green-600">{formatCurrency(bill.paidAmount)}</td>
                            <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold', parseFloat(bill.pendingAmount) > 0 ? 'text-red-600' : 'text-green-600')}>
                              {formatCurrency(bill.pendingAmount)}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={cn(
                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                                bill.isPaid ? 'bg-green-100 text-green-700' : bill.isPublished ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600',
                              )}>
                                {bill.isPaid ? '✓ Paid' : bill.isPublished ? 'Unpaid' : 'Draft'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                          <td className="px-4 py-3 text-slate-700" colSpan={2}>Total</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatCurrency(reportBills.reduce((s: number, b: any) => s + parseFloat(b.baseAmount), 0))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-blue-600">
                            {formatCurrency(reportBills.reduce((s: number, b: any) => s + parseFloat(b.waterCharges), 0))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatCurrency(reportBills.reduce((s: number, b: any) => s + parseFloat(b.adjustments), 0))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(period.totalBilled)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-green-700">{formatCurrency(period.totalCollected)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-red-600">{formatCurrency(period.totalPending)}</td>
                          <td className="px-4 py-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Line items per flat (expanded) */}
                {reportBills.some((b: any) => b.lineItems?.length > 0) && (
                  <div className="space-y-3 print:space-y-4">
                    <h3 className="text-sm font-semibold text-slate-700">Bill Breakdown by Flat</h3>
                    {reportBills.map((bill: any) => (
                      <div key={bill.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden print:break-inside-avoid">
                        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-slate-900">{bill.flatCode}</span>
                            <span className="font-mono text-xs text-slate-400">{bill.invoiceNumber}</span>
                          </div>
                          <span className="font-bold text-slate-900">{formatCurrency(bill.totalAmount)}</span>
                        </div>
                        {bill.lineItems?.length > 0 && (
                          <table className="min-w-full text-xs">
                            <tbody className="divide-y divide-slate-50">
                              {bill.lineItems.map((li: any) => (
                                <tr key={li.id}>
                                  <td className="px-4 py-1.5 text-slate-700">{li.componentName}</td>
                                  <td className="px-4 py-1.5 text-slate-500">{li.calculationNote ?? li.description ?? ''}</td>
                                  <td className="px-4 py-1.5 text-right tabular-nums font-medium">{formatCurrency(li.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Water summary tab */}
        {activeTab === 'water' && (
          <div className="space-y-4 print:hidden">
            {waterLoading && <PageSpinner />}
            {!waterLoading && (!waterSummary || waterSummary.readingCount === 0) ? (
              <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
                <Droplets size={32} className="mx-auto mb-3 text-slate-300" />
                No water readings recorded for this period.{' '}
                <Link href="/water" className="text-primary-600 underline">
                  Go to Water Billing
                </Link>
                {' '}to enter readings.
              </div>
            ) : waterSummary && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                  {[
                    { label: 'Total Water Cost', value: formatCurrency(waterSummary.totalCharge) },
                    { label: 'Total Units Consumed', value: `${waterSummary.totalUnits?.toFixed(2)} KL` },
                    { label: 'Rate per KL', value: formatCurrency(waterSummary.ratePerUnit) },
                  ].map(({ label, value }) => (
                    <Card key={label} padding="lg">
                      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                    </Card>
                  ))}
                </div>
                <Card padding="none">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Flat</Th>
                        <Th>Opening (KL)</Th>
                        <Th>Closing (KL)</Th>
                        <Th>Consumed (KL)</Th>
                        <Th>Water Charge</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {waterSummary.readings.map((r: any) => (
                        <Tr key={r.id}>
                          <Td className="font-semibold">{r.flatCode}</Td>
                          <Td className="tabular-nums">{r.openingReading?.toFixed(3)}</Td>
                          <Td className="tabular-nums">{r.closingReading?.toFixed(3)}</Td>
                          <Td className="tabular-nums">{r.consumption?.toFixed(3)}</Td>
                          <Td className="tabular-nums font-semibold text-blue-600">
                            {formatCurrency(r.calculatedAmount ?? 0)}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Card>
              </div>
            )}
          </div>
        )}
      </PageContainer>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:pt-0 { padding-top: 0 !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          body { background: white !important; }
          nav, aside, header { display: none !important; }
          main { padding: 0 !important; }
        }
      `}</style>

      {/* ── Remind All Unpaid modal ──────────────────────────────────────────
           Lists every unpaid published bill with a direct WhatsApp button.
           When the resident's phone number is on file, the button opens
           wa.me/PHONE?text=… — no searching for the contact needed.
           When no phone is stored, it falls back to wa.me/?text=… so admin
           picks the contact manually.
      ────────────────────────────────────────────────────────────────────── */}
      {remindAllOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 print:hidden"
          onClick={() => setRemindAllOpen(false)}
        >
          <div
            className="w-full max-w-lg mx-0 sm:mx-4 bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <MessageSquare size={16} className="text-green-600" />
                  Send WhatsApp Reminders
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {unpaidBills.length} unpaid {unpaidBills.length === 1 ? 'flat' : 'flats'} ·{' '}
                  {unpaidBills.filter((b) => !!b.residentPhone).length} with saved numbers
                </p>
              </div>
              <button
                onClick={() => setRemindAllOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
              {unpaidBills.map((bill) => {
                const phone = bill.residentPhone;
                const residentName = bill.residentName;
                const pending = parseFloat(bill.pendingAmount ?? '0');
                return (
                  <div key={bill.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                    {/* Flat info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{bill.flatCode}</p>
                      {residentName && (
                        <p className="text-xs text-slate-500 truncate">{residentName}</p>
                      )}
                      {phone && (
                        <p className="text-xs text-green-600 font-mono">{phone}</p>
                      )}
                    </div>

                    {/* Pending amount */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-red-600 tabular-nums">
                        {formatCurrency(pending)}
                      </p>
                      <p className="text-[10px] text-slate-400">pending</p>
                    </div>

                    {/* WhatsApp button */}
                    <button
                      onClick={() => openWhatsApp(buildBillMessage(bill, period), phone)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors shrink-0',
                        phone
                          ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200',
                      )}
                      title={phone ? `Open chat with ${phone}` : 'Open WhatsApp (pick contact manually)'}
                    >
                      <MessageSquare size={12} />
                      {phone ? 'Send' : 'Remind'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50 rounded-b-2xl">
              {/* Copy all phone numbers that we have */}
              {unpaidBills.some((b) => !!b.residentPhone) ? (
                <button
                  onClick={() => {
                    const nums = unpaidBills
                      .map((b) => b.residentPhone)
                      .filter(Boolean)
                      .join(', ');
                    navigator.clipboard.writeText(nums);
                    toast.success('Phone numbers copied — paste into a WhatsApp broadcast list');
                  }}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <CheckCircle2 size={13} />
                  Copy all numbers
                </button>
              ) : (
                <p className="text-xs text-slate-400">
                  Phone numbers will appear here once residents register.
                </p>
              )}
              <button
                onClick={() => setRemindAllOpen(false)}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
