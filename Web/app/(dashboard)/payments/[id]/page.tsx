'use client';

import { useState, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { paymentsApi, reportsApi } from '@/lib/api/endpoints';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, paymentStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

export default function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const { data: payment, isLoading } = useQuery({
    queryKey: ['payment', id],
    queryFn: () => paymentsApi.get(id).then((r) => r.data),
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => reportsApi.accountBalances().then((r: any) => r.data as Array<{
      id: string; name: string; accountType: string; currentBalance: string;
    }>),
  });

  const primaryAccount = accounts?.find(
    (a) => a.accountType === 'CURRENT' || a.accountType === 'SAVINGS',
  ) ?? accounts?.[0];

  const approveMutation = useMutation({
    mutationFn: () => {
      if (!primaryAccount) throw new Error('No account available to credit');
      return paymentsApi.approve(id, primaryAccount.id);
    },
    onSuccess: () => {
      toast.success('Payment approved');
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.push('/payments');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to approve payment'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => paymentsApi.reject(id, rejectionReason),
    onSuccess: () => {
      toast.success('Payment rejected');
      qc.invalidateQueries({ queryKey: ['payments'] });
      setShowRejectModal(false);
      router.push('/payments');
    },
    onError: () => toast.error('Failed to reject payment'),
  });

  const handleApprove = () => {
    if (!primaryAccount) {
      toast.error('No society account configured. Please set up an account first.');
      return;
    }
    if (!confirm(`Approve ₹${payment?.amount} → ${primaryAccount.name}?`)) return;
    approveMutation.mutate();
  };

  if (isLoading) return <PageSpinner />;
  if (!payment) return <div className="p-8 text-slate-500">Payment not found.</div>;

  const isPending = payment.status === 'PENDING' || payment.status === 'UNDER_REVIEW';
  const residentName = payment.user
    ? `${payment.user.firstName} ${payment.user.lastName}`
    : '—';

  return (
    <>
      <Header
        title={payment.referenceNumber ?? `Payment ${payment.id.slice(0, 8)}`}
        subtitle="Payment detail"
        actions={
          <Link href="/payments">
            <button className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              <ArrowLeft size={14} /> Back
            </button>
          </Link>
        }
      />
      <PageContainer className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Payment info */}
          <Card padding="lg">
            <CardHeader>
              <CardTitle>Payment Details</CardTitle>
              <Badge variant={paymentStatusBadge(payment.status)}>
                {payment.status.replace(/_/g, ' ')}
              </Badge>
            </CardHeader>
            <dl className="space-y-3 text-sm">
              {[
                { label: 'Amount', value: <span className="text-xl font-bold text-slate-900">{formatCurrency(payment.amount)}</span> },
                { label: 'Method', value: payment.paymentMethod.replace(/_/g, ' ') },
                { label: 'Reference #', value: payment.referenceNumber ?? '—' },
                { label: 'UTR Number', value: payment.utrNumber ?? '—' },
                { label: 'Payment Date', value: formatDate(payment.paymentDate) },
                { label: 'Submitted', value: formatDateTime(payment.createdAt) },
                ...(payment.approvedAt ? [{ label: 'Approved at', value: formatDateTime(payment.approvedAt) }] : []),
                ...(payment.rejectedAt ? [{ label: 'Rejected at', value: formatDateTime(payment.rejectedAt) }] : []),
                ...(payment.notes ? [{ label: 'Notes', value: payment.notes }] : []),
                ...(payment.reviewNotes ? [{ label: 'Review notes', value: <span className="text-red-600">{payment.reviewNotes}</span> }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900 text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* Flat / resident info */}
          <Card padding="lg">
            <CardHeader><CardTitle>Flat / Resident</CardTitle></CardHeader>
            <dl className="space-y-3 text-sm">
              {[
                { label: 'Flat', value: payment.flat?.flatCode ?? payment.flatId },
                { label: 'Resident', value: residentName },
                ...(payment.maintenanceBill ? [{ label: 'Invoice #', value: payment.maintenanceBill.invoiceNumber }] : []),
                ...(primaryAccount ? [{ label: 'Will credit to', value: primaryAccount.name }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        {/* Actions */}
        {isPending && (
          <Card padding="lg">
            <CardTitle className="mb-4">Verify Payment</CardTitle>
            <p className="mb-5 text-sm text-slate-600">
              Approving will record this payment and update the account balance.
            </p>
            <div className="flex gap-3">
              <Button
                onClick={handleApprove}
                loading={approveMutation.isPending}
                className="flex items-center gap-2"
              >
                <CheckCircle2 size={16} />
                Approve Payment
              </Button>
              <Button
                variant="danger"
                onClick={() => setShowRejectModal(true)}
                className="flex items-center gap-2"
              >
                <XCircle size={16} />
                Reject
              </Button>
            </div>
          </Card>
        )}
      </PageContainer>

      {/* Reject Modal */}
      <Modal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="Reject Payment"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Provide a reason for rejecting this payment. It will be saved in the review notes.
          </p>
          <Textarea
            label="Reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="e.g. Reference number does not match bank records"
            rows={4}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowRejectModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={rejectMutation.isPending}
              disabled={!rejectionReason.trim()}
              onClick={() => rejectMutation.mutate()}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
