import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { MaintenanceBill } from '@/types/billing.types';

export default function ResidentMaintenanceScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['my-bills'],
    queryFn: () => billingApi.getMyBills({ limit: 24 }),
  });

  const renderItem = ({ item }: { item: MaintenanceBill }) => (
    <View style={styles.card}>
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
          <Text style={styles.lineItemAmount}>₹{parseFloat(li.amount).toLocaleString('en-IN')}</Text>
        </View>
      ))}

      <View style={styles.divider} />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalAmount}>₹{parseFloat(item.totalAmount).toLocaleString('en-IN')}</Text>
      </View>

      {!item.isPaid && (
        <View style={styles.pendingRow}>
          <Text style={styles.pendingLabel}>Outstanding</Text>
          <Text style={styles.pendingAmount}>₹{parseFloat(item.pendingAmount).toLocaleString('en-IN')}</Text>
        </View>
      )}
    </View>
  );

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
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="No bills yet"
              description="Your maintenance bills will appear here once generated."
            />
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
});
