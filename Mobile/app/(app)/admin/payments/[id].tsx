import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsApi } from '@/api/endpoints/payments.api';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatusBadge, paymentStatusVariant } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography, radius } from '@/theme';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const { data: payment, isLoading } = useQuery({
    queryKey: ['payment', id],
    queryFn: () => paymentsApi.getPayment(id),
    enabled: !!id,
  });

  // Fetch society accounts to credit on approval
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: Array<{ id: string; name: string; accountType: string }> }>('/reports/account-balances');
      return res.data.data ?? [];
    },
  });

  // Use the first CURRENT or SAVINGS account, falling back to the first account available
  const creditAccount =
    accounts?.find((a) => a.accountType === 'CURRENT' || a.accountType === 'SAVINGS') ?? accounts?.[0];

  const approveMutation = useMutation({
    mutationFn: () => {
      if (!creditAccount) throw new Error('No account available to credit.');
      return paymentsApi.approvePayment(id, creditAccount.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
      Alert.alert('Approved', 'Payment has been approved and recorded.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (err: any) =>
      Alert.alert('Error', err?.message ?? 'Failed to approve payment.'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => paymentsApi.rejectPayment(id, rejectionReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      Alert.alert('Rejected', 'Payment has been rejected.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: () => Alert.alert('Error', 'Failed to reject payment.'),
  });

  const canTakeAction = payment?.status === 'PENDING' || payment?.status === 'UNDER_REVIEW';

  if (isLoading) return <LoadingState fullscreen message="Loading payment..." />;
  if (!payment) return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payment Review" showBack />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
        <Ionicons name="card-outline" size={48} color="#CBD5E1" />
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#334155' }}>Payment not found</Text>
        <Text style={{ fontSize: 14, color: '#64748B', textAlign: 'center' }}>This payment may have been removed or already processed.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 8, backgroundColor: '#0D2147', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payment Review" showBack />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status */}
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View>
              <Text style={styles.amountLarge}>
                ₹{parseFloat(payment.amount).toLocaleString('en-IN')}
              </Text>
              <Text style={styles.submittedLabel}>
                Submitted {new Date(payment.createdAt).toLocaleDateString('en-IN')}
              </Text>
            </View>
            <StatusBadge label={payment.status} variant={paymentStatusVariant(payment.status)} />
          </View>
        </Card>

        {/* Flat info */}
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Resident Details</Text>
            {(payment.user as any)?.phone && (
              <TouchableOpacity
                style={styles.waContactBtn}
                onPress={() => {
                  const phone = (payment.user as any).phone as string;
                  const digits = phone.replace(/\D/g, '');
                  const wa = digits.startsWith('91') ? digits : `91${digits}`;
                  Linking.openURL(`https://wa.me/${wa}`).catch(() => {});
                }}
                hitSlop={8}
              >
                <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                <Text style={styles.waContactText}>WhatsApp</Text>
              </TouchableOpacity>
            )}
          </View>
          <InfoRow
            label="Resident"
            value={payment.user ? `${payment.user.firstName} ${payment.user.lastName}` : '—'}
          />
          <InfoRow label="Flat" value={payment.flat?.flatCode ?? payment.flatId ?? '—'} />
          <InfoRow label="Invoice #" value={payment.maintenanceBill?.invoiceNumber ?? '—'} />
        </Card>

        {/* Payment details */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Details</Text>
          <InfoRow
            label="Payment Date"
            value={new Date(payment.paymentDate).toLocaleDateString('en-IN')}
          />
          <InfoRow label="Method" value={payment.paymentMethod?.replace(/_/g, ' ') ?? '—'} />
          {payment.referenceNumber && (
            <InfoRow label="Reference / UTR" value={payment.referenceNumber} />
          )}
          {payment.notes && <InfoRow label="Notes" value={payment.notes} />}
        </Card>

        {/* Credit account info */}
        {canTakeAction && creditAccount && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Credit Account</Text>
            <InfoRow label="Account" value={creditAccount.name} />
            <InfoRow label="Type" value={creditAccount.accountType.replace(/_/g, ' ')} />
          </Card>
        )}

        {/* Rejection reason if rejected */}
        {payment.status === 'REJECTED' && payment.reviewNotes && (
          <Card style={[styles.section, styles.rejectedCard]}>
            <Text style={styles.rejectedTitle}>Rejection Reason</Text>
            <Text style={styles.rejectedText}>{payment.reviewNotes}</Text>
          </Card>
        )}

        {/* Actions */}
        {canTakeAction && (
          <View style={styles.actions}>
            {!showRejectForm ? (
              <>
                <Button
                  label="Approve Payment"
                  onPress={() =>
                    Alert.alert(
                      'Approve Payment',
                      `Approve ₹${parseFloat(payment.amount).toLocaleString('en-IN')}${creditAccount ? ` → ${creditAccount.name}` : ''}?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Approve', onPress: () => approveMutation.mutate() },
                      ],
                    )
                  }
                  loading={approveMutation.isPending}
                  disabled={!creditAccount}
                  fullWidth
                  size="lg"
                />
                {!creditAccount && (
                  <Text style={styles.noAccountWarning}>
                    No operating account found. Contact platform admin.
                  </Text>
                )}
                <Button
                  label="Reject Payment"
                  onPress={() => setShowRejectForm(true)}
                  variant="outline"
                  fullWidth
                />
              </>
            ) : (
              <Card style={styles.rejectForm}>
                <Text style={styles.rejectFormTitle}>Reason for Rejection</Text>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Enter rejection reason..."
                  value={rejectionReason}
                  onChangeText={setRejectionReason}
                  multiline
                  numberOfLines={3}
                  placeholderTextColor={colors.textTertiary}
                />
                <View style={styles.rejectActions}>
                  <Button
                    label="Cancel"
                    onPress={() => setShowRejectForm(false)}
                    variant="outline"
                    style={styles.flex1}
                  />
                  <Button
                    label="Confirm Reject"
                    onPress={() => {
                      if (!rejectionReason.trim()) {
                        Alert.alert('Required', 'Please enter a rejection reason.');
                        return;
                      }
                      rejectMutation.mutate();
                    }}
                    loading={rejectMutation.isPending}
                    variant="danger"
                    style={styles.flex1}
                  />
                </View>
              </Card>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md, paddingBottom: spacing['3xl'] },
  statusCard: { gap: spacing.sm },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  amountLarge: { ...typography.displaySmall, color: colors.text },
  submittedLabel: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 4 },

  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...typography.headingSmall, color: colors.text },
  waContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F0FDF4', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#BBF7D0' },
  waContactText: { ...typography.labelSmall, color: '#16A34A', fontWeight: '600' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  infoLabel: { ...typography.bodyMedium, color: colors.textSecondary, flex: 1 },
  infoValue: { ...typography.bodyMedium, color: colors.text, flex: 1.5, textAlign: 'right' },

  rejectedCard: { backgroundColor: colors.errorLight, borderColor: '#FECACA' },
  rejectedTitle: { ...typography.labelLarge, color: colors.error },
  rejectedText: { ...typography.bodyMedium, color: '#991B1B' },

  noAccountWarning: { ...typography.bodySmall, color: colors.error, textAlign: 'center' },

  actions: { gap: spacing.md },
  rejectForm: { gap: spacing.md },
  rejectFormTitle: { ...typography.labelLarge, color: colors.text },
  reasonInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.bodyMedium,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  rejectActions: { flexDirection: 'row', gap: spacing.md },
  flex1: { flex: 1 },
});
