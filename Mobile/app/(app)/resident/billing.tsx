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
import { MaintenanceBill } from '@/types/billing.types';

export default function ResidentBillingScreen() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['resident-my-bills'],
    queryFn: () => billingApi.getMyBills({ limit: 24, page: 1 }),
  });

  const bills: MaintenanceBill[] = data?.data ?? [];

  const renderItem = ({ item }: { item: MaintenanceBill }) => {
    const isPaid = item.isPaid;
    const pending = parseFloat(item.pendingAmount ?? '0');

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/(app)/resident/bills/${item.id}` as any)}

      >
        <View style={styles.cardTop}>
          <View>
            <Text style={styles.invoiceNumber}>{item.invoiceNumber}</Text>
          </View>
          <StatusBadge
            label={isPaid ? 'PAID' : 'PENDING'}
            variant={isPaid ? 'success' : 'warning'}
          />
        </View>

        <View style={styles.amounts}>
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>Total</Text>
            <Text style={styles.amountValue}>
              ₹{parseFloat(item.totalAmount ?? '0').toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>Paid</Text>
            <Text style={[styles.amountValue, styles.green]}>
              ₹{parseFloat(item.paidAmount ?? '0').toLocaleString('en-IN')}
            </Text>
          </View>
          {!isPaid && (
            <View style={styles.amountBlock}>
              <Text style={styles.amountLabel}>Due</Text>
              <Text style={[styles.amountValue, styles.orange]}>
                ₹{pending.toLocaleString('en-IN')}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.dueDate}>
          Due: {new Date(item.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="My Bills" />
      {isLoading ? (
        <LoadingState />
      ) : bills.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="No bills yet"
          description="Your published maintenance bills will appear here."
        />
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(b) => b.id}
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  invoiceNumber: {
    ...typography.bodyMedium,
    fontWeight: '700',
    color: colors.text,
  },
  amounts: {
    flexDirection: 'row',
    gap: spacing.base,
  },
  amountBlock: { flex: 1 },
  amountLabel: {
    ...typography.labelSmall,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  amountValue: {
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
