'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt, Download, ChevronDown, ChevronUp, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { billingApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, formatDate, parseDecimalLike, cn } from '@/lib/utils';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function BillCard({ bill }: { bill: any }) {
  const [expanded, setExpanded] = useState(false);
  const period = bill.billingPeriod;
  const isPaid = bill.isPaid;
  const pending = parseFloat(bill.pendingAmount);
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
        <div className="border-t border-slate-100 px-5 py-4 space-y-3">
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
                {parseFloat(bill.baseAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">Maintenance</span>
                    <span className="font-medium">{formatCurrency(bill.baseAmount)}</span>
                  </div>
                )}
                {parseFloat(bill.waterCharges) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">Water Charges</span>
                    <span className="font-medium text-blue-700">{formatCurrency(bill.waterCharges)}</span>
                  </div>
                )}
                {parseFloat(bill.adjustments) !== 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">Adjustments</span>
                    <span className={cn('font-medium', parseFloat(bill.adjustments) < 0 ? 'text-green-600' : 'text-red-600')}>
                      {formatCurrency(bill.adjustments)}
                    </span>
                  </div>
                )}
                {parseFloat(bill.lateFee) > 0 && (
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

  const { data, isLoading } = useQuery({
    queryKey: ['my-bills'],
    queryFn: () => billingApi.getMyBills({ limit: 24 }).then((r: any) => r.data ?? r),
  });

  const bills: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  const totalPending = bills.reduce((s, b) => s + parseDecimalLike(b.pendingAmount), 0);
  const totalPaid = bills.reduce((s, b) => s + parseDecimalLike(b.paidAmount), 0);

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

            {/* Bills */}
            <div className="space-y-3">
              {bills.map((bill) => <BillCard key={bill.id} bill={bill} />)}
            </div>
          </>
        )}
      </PageContainer>
    </>
  );
}
