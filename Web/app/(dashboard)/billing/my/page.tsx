'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, Download, ChevronDown, ChevronUp, CheckCircle2, Clock, AlertCircle, Copy, Check, Smartphone, ExternalLink } from 'lucide-react';
import { billingApi, societyApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate, parseDecimalLike, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function UpiPayCard({
  bill,
  upiId,
  societyName,
  verificationRequired,
  onPaid,
}: {
  bill: any;
  upiId: string;
  societyName: string;
  verificationRequired: boolean;
  onPaid: () => void;
}) {
  const [utr, setUtr] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pending = parseDecimalLike(bill.pendingAmount);

  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(societyName)}&am=${pending}&tn=${encodeURIComponent(`Invoice ${bill.invoiceNumber}`)}&cu=INR`;

  function copyUpi() {
    navigator.clipboard.writeText(upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function submitPayment() {
    if (!utr.trim()) { toast.error('Please enter your UTR / transaction ID'); return; }
    if (!bill?.id || !bill?.billingPeriodId) { toast.error('Bill information missing. Please refresh and try again.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/backend/payments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maintenanceBillId: bill.id,
          billingPeriodId: bill.billingPeriodId,
          amount: pending,
          paymentDate: new Date().toISOString().split('T')[0],
          paymentMethod: 'UPI',
          utrNumber: utr.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Payment submission failed');

      if (data.autoApproved) {
        toast.success('✅ Payment confirmed! Bill marked as paid.');
      } else {
        toast.success('Payment submitted! Admin will verify shortly.');
      }
      onPaid();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 space-y-4">
      <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide">Pay via UPI</p>

      {/* UPI ID row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg border border-primary-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 select-all">
          {upiId}
        </div>
        <button
          onClick={copyUpi}
          className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 py-2 text-xs font-medium text-primary-700 hover:bg-primary-50 transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Amount */}
      <div className="text-center">
        <p className="text-xs text-slate-500">Amount to pay</p>
        <p className="text-2xl font-bold text-primary-700">{formatCurrency(pending)}</p>
        <p className="text-xs text-slate-400 mt-1">Ref: Invoice {bill.invoiceNumber}</p>
      </div>

      {/* Open UPI App button */}
      <a
        href={upiLink}
        className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary-600 text-white py-3 text-sm font-semibold hover:bg-primary-700 active:scale-95 transition-all"
      >
        <Smartphone size={16} />
        Open UPI App (GPay / PhonePe / Paytm)
      </a>

      {/* Divider */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-slate-200" />
        <span className="text-xs text-slate-400">After paying</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>

      {/* UTR entry */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-600">
          Enter UTR / Transaction ID from your UPI app
        </label>
        <input
          type="text"
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          placeholder="e.g. 426101234567"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 placeholder:text-slate-300"
        />
        <button
          onClick={submitPayment}
          disabled={submitting || !utr.trim()}
          className="w-full rounded-xl bg-green-600 text-white py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Confirming…' : 'Confirm Payment'}
        </button>
        <p className="text-[11px] text-center text-slate-400">
          {verificationRequired
            ? 'Admin will verify your UTR and confirm within 24 hrs.'
            : '✅ Payment will be auto-confirmed once submitted.'}
        </p>
      </div>
    </div>
  );
}

function BillCard({ bill, upiId, societyName, verificationRequired, onPaid }: {
  bill: any;
  upiId: string;
  societyName: string;
  verificationRequired: boolean;
  onPaid: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showUpi, setShowUpi] = useState(false);
  const period = bill.billingPeriod;
  const isPaid = bill.isPaid;
  const pending = parseDecimalLike(bill.pendingAmount);
  const hasPending = pending > 0;

  return (
    <div className={cn(
      'rounded-xl border bg-white shadow-sm overflow-hidden',
      isPaid ? 'border-green-200' : hasPending ? 'border-amber-200' : 'border-slate-200',
    )}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
            isPaid ? 'bg-green-100' : hasPending ? 'bg-amber-100' : 'bg-slate-100',
          )}>
            {isPaid
              ? <CheckCircle2 size={18} className="text-green-600" />
              : hasPending
              ? <AlertCircle size={18} className="text-amber-600" />
              : <Clock size={18} className="text-slate-500" />}
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              {period ? `${MONTH_NAMES[period.periodMonth]} ${period.periodYear}` : 'Maintenance Bill'}
            </p>
            <p className="text-xs text-slate-500">
              Invoice {bill.invoiceNumber} · Due {formatDate(bill.dueDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-lg font-bold text-slate-900">{formatCurrency(bill.totalAmount)}</p>
            {hasPending && (
              <p className="text-xs text-amber-600 font-medium">
                {formatCurrency(pending)} pending
              </p>
            )}
            {isPaid && (
              <p className="text-xs text-green-600 font-medium">Fully paid</p>
            )}
          </div>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {/* Expanded: line items */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          {/* Bill breakdown */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Bill Breakdown</p>
            {bill.lineItems?.length > 0 ? (
              bill.lineItems.map((li: any) => (
                <div key={li.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{li.componentName}</span>
                  <span className="font-medium text-slate-900">{formatCurrency(li.amount)}</span>
                </div>
              ))
            ) : (
              <>
                {parseDecimalLike(bill.baseAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">Maintenance</span>
                    <span className="font-medium">{formatCurrency(bill.baseAmount)}</span>
                  </div>
                )}
                {parseDecimalLike(bill.waterCharges) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">Water Charges</span>
                    <span className="font-medium text-blue-700">{formatCurrency(bill.waterCharges)}</span>
                  </div>
                )}
                {parseDecimalLike(bill.lateFee) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">Late Fee</span>
                    <span className="font-medium text-red-600">{formatCurrency(bill.lateFee)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-1.5 mt-1.5">
              <span className="text-slate-900">Total</span>
              <span>{formatCurrency(bill.totalAmount)}</span>
            </div>
          </div>

          {/* Payment status */}
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Status</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Amount Paid</span>
              <span className="font-medium text-green-700">{formatCurrency(bill.paidAmount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Balance Due</span>
              <span className={cn('font-semibold', hasPending ? 'text-red-600' : 'text-green-600')}>
                {formatCurrency(bill.pendingAmount)}
              </span>
            </div>
          </div>

          {/* UPI Pay section (only for unpaid bills with UPI configured) */}
          {hasPending && upiId && (
            <>
              {!showUpi ? (
                <button
                  onClick={() => setShowUpi(true)}
                  className="flex items-center justify-center gap-2 w-full rounded-xl border-2 border-primary-300 bg-primary-50 text-primary-700 py-3 text-sm font-semibold hover:bg-primary-100 transition-colors"
                >
                  <Smartphone size={16} />
                  Pay ₹{pending.toLocaleString('en-IN')} via UPI
                </button>
              ) : (
                <UpiPayCard
                  bill={bill}
                  upiId={upiId}
                  societyName={societyName}
                  verificationRequired={verificationRequired}
                  onPaid={onPaid}
                />
              )}
            </>
          )}

          {/* Print button */}
          <div className="flex justify-end">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-100 transition-colors"
            >
              <Download size={12} /> Download Receipt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyBillsPage() {
  const { user, activeMembership } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['my-bills'],
    queryFn: () => billingApi.getMyBills({ limit: 24 }).then((r: any) => r.data ?? r),
  });

  const { data: configRaw } = useQuery({
    queryKey: ['society-config'],
    queryFn: () => societyApi.getConfig().then((r: any) => r.data ?? r),
  });

  const { data: societyRaw } = useQuery({
    queryKey: ['my-society'],
    queryFn: () => societyApi.getMySociety().then((r: any) => r.data ?? r),
  });

  const bills: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  const totalPending = bills.reduce((s, b) => s + parseDecimalLike(b.pendingAmount), 0);
  const totalPaid = bills.reduce((s, b) => s + parseDecimalLike(b.paidAmount), 0);

  // Extract UPI config
  const upiId: string = (configRaw?.additionalConfig as any)?.upiId ?? '';
  const verificationRequired: boolean = configRaw?.paymentVerificationRequired !== false;
  const societyName: string = societyRaw?.displayName ?? societyRaw?.name ?? 'Society';

  return (
    <>
      <Header
        title="My Bills"
        subtitle={activeMembership?.flatNumber ? `Flat ${activeMembership.flatNumber}` : 'Your maintenance bills'}
      />
      <PageContainer className="space-y-6">
        {isLoading ? (
          <PageSpinner />
        ) : bills.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No bills yet"
            description="Your published maintenance bills will appear here."
          />
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-4">
              <Card padding="lg">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total Pending</p>
                <p className={cn('mt-1 text-2xl font-bold', totalPending > 0 ? 'text-red-600' : 'text-green-600')}>
                  {formatCurrency(totalPending)}
                </p>
              </Card>
              <Card padding="lg">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total Paid</p>
                <p className="mt-1 text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</p>
              </Card>
            </div>

            {/* UPI hint if configured */}
            {upiId && totalPending > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3">
                <Smartphone size={16} className="text-primary-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-primary-700">
                  <strong>Pay via UPI</strong> — Open any bill below, tap &quot;Pay via UPI&quot;, scan or open your UPI app, and enter the transaction ID to confirm.
                  {!verificationRequired && ' Payments are auto-confirmed instantly.'}
                </p>
              </div>
            )}

            {/* Bills */}
            <div className="space-y-3">
              {bills.map((bill) => (
                <BillCard
                  key={bill.id}
                  bill={bill}
                  upiId={upiId}
                  societyName={societyName}
                  verificationRequired={verificationRequired}
                  onPaid={() => refetch()}
                />
              ))}
            </div>
          </>
        )}
      </PageContainer>
    </>
  );
}
