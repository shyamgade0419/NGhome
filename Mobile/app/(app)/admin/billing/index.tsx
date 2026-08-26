import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { BillingPeriod } from '@/types/billing.types';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const statusVariant = (status: string) => {
  switch (status) {
    case 'DRAFT': return 'neutral' as const;
    case 'CALCULATED': return 'info' as const;
    case 'REVIEW': return 'warning' as const;
    case 'PUBLISHED': return 'success' as const;
    case 'PARTIALLY_PAID': return 'warning' as const;
    case 'PAID': return 'success' as const;
    case 'CLOSED': return 'error' as const;
    default: return 'neutral' as const;
  }
};

export default function AdminBillingScreen() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-billing-periods'],
    queryFn: () => billingApi.getBillingPeriods({ limit: 30, page: 1 }),
  });

  const periods: BillingPeriod[] = data?.data ?? [];

  const renderItem = ({ item }: { item: BillingPeriod }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => router.push(`/(app)/admin/billing/${item.id}` as any)}
    >
      <View style={styles.cardTop}>
        <Text style={styles.periodLabel}>
          {MONTH_NAMES[(item.periodMonth ?? 1) - 1]} {item.periodYear}
        </Text>
        <StatusBadge label={item.status} variant={statusVariant(item.status)} />
      </View>

      <View style={styles.cardStats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Billed</Text>
          <Text style={styles.statValue}>
            ₹{parseFloat(item.totalBilled ?? '0').toLocaleString('en-IN')}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Collected</Text>
          <Text style={[styles.statValue, styles.green]}>
            ₹{parseFloat(item.totalCollected ?? '0').toLocaleString('en-IN')}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Pending</Text>
          <Text style={[styles.statValue, styles.orange]}>
            ₹{parseFloat(item.totalPending ?? '0').toLocaleString('en-IN')}
          </Text>
        </View>
      </View>

      <Text style={styles.dueDate}>
        Due: {new Date(item.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Billing" />
      {isLoading ? (
        <LoadingState />
      ) : periods.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No billing periods"
          description="Create a billing period to get started."
        />
      ) : (
        <FlatList
          data={periods}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  periodLabel: {
    ...typography.headingSmall,
    color: colors.text,
  },
  cardStats: {
    flexDirection: 'row',
    gap: spacing.base,
  },
  stat: { flex: 1 },
  statLabel: {
    ...typography.labelSmall,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  statValue: {
    ...typography.bodyMedium,
    fontWeight: '600',
    color: colors.text,
  },
  green: { color: colors.success },
  orange: { color: colors.warning },
  dueDate: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
