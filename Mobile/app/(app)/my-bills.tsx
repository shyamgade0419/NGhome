import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { MaintenanceBill } from '@/types/billing.types';
import { inr, toNum } from '@/utils/format';

export default function ResidentMaintenanceScreen() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['my-bills'],
    queryFn: () => billingApi.getMyBills({ limit: 24 }),
  });

  const { data: preview, refetch: refetchPreview } = useQuery({
    queryKey: ['my-bill-preview'],
    queryFn: billingApi.previewMyBill,
  });

  const renderItem = ({ item }: { item: MaintenanceBill }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => router.push(`/(app)/resident/bills/${item.id}` as any)}
    >
      <View style={styles.cardTop}>
        <View>
          <Text style={styles.invoiceNum}>{item.invoiceNumber ?? '—'}</Text>
          <Text style={styles.dueDate}>
            Due: {new Date(item.dueDate).toLocaleDateString('en-IN')}
          </Text>
        </View>
        <StatusBadge
          label={item.isPaid ? 'PAID' : 'PENDING'}
          variant={item.isPaid ? 'success' : 'warning'}
        />
      </View>

      {/* Line items */}
      <View style={styles.divider} />
      {(item.lineItems ?? []).map((li, i) => (
        <View key={i} style={styles.lineItem}>
          <Text style={styles.lineItemName}>{li.componentName}</Text>
          <Text style={styles.lineItemAmount}>{inr(li.amount)}</Text>
        </View>
      ))}

      <View style={styles.divider} />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalAmount}>{inr(item.totalAmount)}</Text>
      </View>

      {!item.isPaid && (
        <View style={styles.pendingRow}>
          <Text style={styles.pendingLabel}>Outstanding</Text>
          <Text style={styles.pendingAmount}>{inr(item.pendingAmount)}</Text>
        </View>
      )}

      {/* Drill-in hint */}
      <View style={styles.drillRow}>
        <Text style={styles.drillHint}>Tap for full details &amp; share</Text>
        <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );

  const previewCard = preview ? (
    <View style={styles.previewCard}>
      <View style={styles.previewHeader}>
        <StatusBadge label="PREVIEW" variant="info" size="sm" />
        <Text style={styles.previewHeaderText}>
          {new Date(preview.dueDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </Text>
      </View>
      <Text style={styles.previewNote}>
        Not yet published by your society — figures may still change before the final bill.
      </Text>
      <View style={styles.divider} />
      {toNum(preview.baseAmount) > 0 && (
        <View style={styles.lineItem}>
          <Text style={styles.lineItemName}>Maintenance</Text>
          <Text style={styles.lineItemAmount}>{inr(preview.baseAmount)}</Text>
        </View>
      )}
      {toNum(preview.waterCharges) > 0 && (
        <View style={styles.lineItem}>
          <Text style={styles.lineItemName}>Water</Text>
          <Text style={styles.lineItemAmount}>{inr(preview.waterCharges)}</Text>
        </View>
      )}
      {toNum(preview.lateFee) > 0 && (
        <View style={styles.lineItem}>
          <Text style={styles.lineItemName}>Late Fee</Text>
          <Text style={styles.lineItemAmount}>{inr(preview.lateFee)}</Text>
        </View>
      )}
      {toNum(preview.adjustments) !== 0 && (
        <View style={styles.lineItem}>
          <Text style={styles.lineItemName}>{toNum(preview.adjustments) < 0 ? 'Discount' : 'Surcharge'}</Text>
          <Text style={styles.lineItemAmount}>{inr(preview.adjustments)}</Text>
        </View>
      )}
      <View style={styles.divider} />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Estimated Total</Text>
        <Text style={styles.totalAmount}>{inr(preview.totalAmount)}</Text>
      </View>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My Maintenance Bills" />
      {isLoading ? (
        <LoadingState message="Loading bills..." />
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListHeaderComponent={
            previewCard ? <View style={{ marginBottom: spacing.md }}>{previewCard}</View> : null
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => { refetch(); refetchPreview(); }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            previewCard ? null : (
              <EmptyState
                icon="receipt-outline"
                title="No bills yet"
                description="Your maintenance bills will appear here once generated."
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  invoiceNum: { ...typography.headingSmall, color: colors.text },
  dueDate: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.borderLight },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between' },
  lineItemName: { ...typography.bodyMedium, color: colors.textSecondary },
  lineItemAmount: { ...typography.bodyMedium, color: colors.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...typography.labelLarge, color: colors.text },
  totalAmount: { ...typography.headingSmall, color: colors.text },
  pendingRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.warningLight, padding: spacing.md, borderRadius: radius.md },
  pendingLabel: { ...typography.labelLarge, color: '#92400E' },
  pendingAmount: { ...typography.headingSmall, color: '#92400E' },
  drillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  drillHint: { ...typography.bodySmall, color: colors.textTertiary },

  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1.5,
    borderColor: colors.info,
    borderStyle: 'dashed',
    gap: spacing.sm,
  },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewHeaderText: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  previewNote: { ...typography.bodySmall, color: colors.textTertiary, lineHeight: 16 },
});
