import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Share,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, billingStatusVariant } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography, radius } from '@/theme';
import { BillingPeriod, MaintenanceBill, billingPeriodName } from '@/types/billing.types';
import { toNum, inr } from '@/utils/format';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function buildBillMessage(bill: MaintenanceBill, period: BillingPeriod): string {
  const month = `${MONTHS[period.periodMonth] ?? ''} ${period.periodYear}`;
  const due = period.dueDate
    ? new Date(period.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const total = toNum(bill.totalAmount);
  const pending = toNum(bill.pendingAmount);
  const water = toNum(bill.waterCharges);

  const lines = [
    `🏢 *${month} Maintenance*`,
    '',
    `Flat: *${bill.flatCode ?? ''}*  |  Invoice: ${bill.invoiceNumber ?? ''}`,
    `Due Date: *${due}*`,
    '',
    `💰 Total: *₹${total.toLocaleString('en-IN')}*`,
  ];
  if (water > 0) {
    lines.push(`   • Maintenance: ${inr(bill.baseAmount)}`);
    lines.push(`   • Water: ₹${water.toLocaleString('en-IN')}`);
  }
  if (bill.isPaid) {
    lines.push('', '✅ *Payment received — Thank you!*');
  } else if (pending > 0) {
    lines.push('', `⚠️ *Balance Due: ₹${pending.toLocaleString('en-IN')}*`);
    lines.push(`Please pay before ${due} to avoid late fees.`);
  }
  return lines.join('\n');
}

function buildGroupMessage(period: BillingPeriod, bills: MaintenanceBill[]): string {
  const month = `${MONTHS[period.periodMonth] ?? ''} ${period.periodYear}`;
  const due = period.dueDate
    ? new Date(period.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const unpaid = bills.filter((b) => !b.isPaid && b.isPublished).length;
  return [
    `🏢 *${month} Maintenance Bills*`,
    '',
    'Dear Residents,',
    '',
    `Your maintenance bills for *${month}* are now published.`,
    `📅 *Due Date: ${due}*`,
    '',
    ...(unpaid > 0 ? [`⚠️ ${unpaid} flat(s) are yet to pay.`] : ['✅ All flats have paid — thank you!']),
    '',
    '📱 Log in to NG Home to view and submit your payment.',
    '',
    '_Society Management_',
  ].join('\n');
}

/* ── Bill row ────────────────────────────────────────────────────── */
function BillRow({
  bill,
  period,
  isAdmin,
}: {
  bill: MaintenanceBill;
  period: BillingPeriod;
  isAdmin: boolean;
}) {
  const pending = toNum(bill.pendingAmount);

  const handleWhatsApp = async () => {
    try {
      await Share.share({ message: buildBillMessage(bill, period) });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  return (
    <View style={billStyles.row}>
      <View style={billStyles.left}>
        <Text style={billStyles.flatCode}>{bill.flatCode}</Text>
        <Text style={billStyles.invoice}>{bill.invoiceNumber}</Text>
      </View>

      <View style={billStyles.amounts}>
        <Text style={billStyles.total}>{inr(bill.totalAmount)}</Text>
        {pending > 0 && !bill.isPaid && (
          <Text style={billStyles.pending}>
            Due {inr(pending)}
          </Text>
        )}
      </View>

      <View style={billStyles.right}>
        <StatusBadge
          label={bill.isPaid ? 'PAID' : bill.isPublished ? 'UNPAID' : 'DRAFT'}
          variant={bill.isPaid ? 'success' : bill.isPublished ? 'warning' : 'neutral'}
        />
        {isAdmin && bill.isPublished && !bill.isPaid && (
          <TouchableOpacity onPress={handleWhatsApp} style={billStyles.waBtn} hitSlop={8}>
            <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const billStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  left: { width: 80 },
  flatCode: { ...typography.headingSmall, color: colors.text },
  invoice: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },
  amounts: { flex: 1 },
  total: { ...typography.labelLarge, color: colors.text },
  pending: { ...typography.bodySmall, color: colors.warning, marginTop: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  waBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E7FFF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/* ── Main Screen ─────────────────────────────────────────────────── */
export default function BillingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: period, isLoading: periodLoading } = useQuery({
    queryKey: ['billing-period', id],
    queryFn: () => billingApi.getBillingPeriod(id),
    enabled: !!id,
  });

  const { data: billsData, isLoading: billsLoading, refetch, isRefetching } = useQuery({
    queryKey: ['billing-period-bills-mobile', id],
    queryFn: () => billingApi.getBillsForPeriod(id, { limit: 200 }),
    enabled: !!id,
  });

  const generateMutation = useMutation({
    mutationFn: () => billingApi.generateBills(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['billing-period', id] });
      qc.invalidateQueries({ queryKey: ['billing-period-bills-mobile', id] });
      Alert.alert('Bills Generated', `${result?.generated ?? 0} bills generated.`);
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to generate.'),
  });

  const publishMutation = useMutation({
    mutationFn: () => billingApi.publishPeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-period', id] });
      qc.invalidateQueries({ queryKey: ['billing-periods'] });
      Alert.alert('Published', 'Bills are now visible to residents.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to publish.'),
  });

  const closeMutation = useMutation({
    mutationFn: () => billingApi.closePeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-period', id] });
      qc.invalidateQueries({ queryKey: ['billing-periods'] });
      Alert.alert('Closed', 'Billing period has been closed.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to close.'),
  });

  const bills: MaintenanceBill[] = billsData?.data ?? [];
  const status = period?.status ?? '';

  const canGenerate = ['DRAFT', 'CALCULATED'].includes(status);
  const canPublish = ['CALCULATED', 'REVIEW'].includes(status);
  const canClose = ['PUBLISHED', 'PARTIALLY_PAID', 'PAID'].includes(status);

  const handleGroupWhatsApp = async () => {
    if (!period) return;
    try {
      await Share.share({ message: buildGroupMessage(period, bills) });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  if (periodLoading) return <LoadingState fullscreen message="Loading period…" />;
  if (!period) return null;

  const totalBilled = toNum(period.totalBilled);
  const totalCollected = toNum(period.totalCollected);
  const totalPending = toNum(period.totalPending);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={billingPeriodName(period)} showBack />

      <FlatList
        data={bills}
        keyExtractor={(b) => b.id}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <>
            {/* Period overview card */}
            <Card style={styles.overviewCard} padding="md">
              <View style={styles.overviewTop}>
                <View>
                  <Text style={styles.overviewTitle}>{billingPeriodName(period)}</Text>
                  {period.dueDate && (
                    <Text style={styles.overviewDue}>
                      Due {new Date(period.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                  )}
                </View>
                <StatusBadge label={status} variant={billingStatusVariant(status)} />
              </View>

              {/* Stats row */}
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Billed</Text>
                  <Text style={[styles.statValue, { color: colors.primary }]}>
                    {inr(totalBilled)}
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Collected</Text>
                  <Text style={[styles.statValue, { color: colors.secondary }]}>
                    {inr(totalCollected)}
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Pending</Text>
                  <Text style={[styles.statValue, { color: totalPending > 0 ? colors.warning : colors.secondary }]}>
                    {inr(totalPending)}
                  </Text>
                </View>
              </View>
            </Card>

            {/* Action buttons */}
            <View style={styles.actionsSection}>
              {canGenerate && (
                <Button
                  label={bills.length > 0 ? 'Re-generate Bills' : 'Generate Bills'}
                  onPress={() =>
                    Alert.alert('Generate Bills', 'Generate bills for all flats?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Generate', onPress: () => generateMutation.mutate() },
                    ])
                  }
                  loading={generateMutation.isPending}
                  variant="outline"
                  fullWidth
                />
              )}
              {canPublish && (
                <Button
                  label="Publish to Residents"
                  onPress={() =>
                    Alert.alert('Publish Bills', 'Publish all bills so residents can see them?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Publish', onPress: () => publishMutation.mutate() },
                    ])
                  }
                  loading={publishMutation.isPending}
                  fullWidth
                />
              )}
              {status === 'PUBLISHED' && bills.length > 0 && (
                <TouchableOpacity onPress={handleGroupWhatsApp} style={styles.waGroupBtn}>
                  <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                  <Text style={styles.waGroupText}>WhatsApp Group Reminder</Text>
                </TouchableOpacity>
              )}
              {canClose && (
                <Button
                  label="Close Period"
                  onPress={() =>
                    Alert.alert('Close Period', 'Mark this billing period as closed? This cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Close', style: 'destructive', onPress: () => closeMutation.mutate() },
                    ])
                  }
                  loading={closeMutation.isPending}
                  variant="outline"
                  fullWidth
                />
              )}
            </View>

            {/* Bills header */}
            {bills.length > 0 && (
              <View style={styles.billsHeader}>
                <Text style={styles.billsHeaderTitle}>All Bills ({bills.length})</Text>
                <Text style={styles.billsHeaderHint}>
                  {bills.filter((b) => b.isPaid).length} paid · {bills.filter((b) => !b.isPaid && b.isPublished).length} unpaid
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <BillRow bill={item} period={period} isAdmin={canGenerate || canPublish || canClose} />
        )}
        ListEmptyComponent={
          billsLoading ? (
            <LoadingState message="Loading bills…" />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title="No bills yet"
              description="Generate bills to see them here."
            />
          )
        }
        ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  overviewCard: {
    margin: spacing.base,
    gap: spacing.md,
  },
  overviewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  overviewTitle: { ...typography.headingMedium, color: colors.text },
  overviewDue: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },

  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { ...typography.labelSmall, color: colors.textSecondary },
  statValue: { ...typography.headingSmall, marginTop: 4 },
  statDivider: { width: 1, height: 36, backgroundColor: colors.border },

  actionsSection: {
    paddingHorizontal: spacing.base,
    gap: spacing.md,
    marginBottom: spacing.base,
  },
  waGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#E7FFF0',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: '#25D366',
  },
  waGroupText: { ...typography.labelLarge, color: '#128C5E' },

  billsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
  },
  billsHeaderTitle: { ...typography.labelLarge, color: colors.text },
  billsHeaderHint: { ...typography.bodySmall, color: colors.textSecondary },
});
