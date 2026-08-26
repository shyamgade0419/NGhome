import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';

interface Expense {
  id: string;
  categoryName: string;
  description: string;
  amount: string;
  expenseDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  payeeName: string | null;
  createdAt: string;
}

function expenseStatusVariant(status: string) {
  switch (status) {
    case 'APPROVED': return 'success' as const;
    case 'PAID': return 'primary' as const;
    case 'PENDING': return 'warning' as const;
    case 'REJECTED': return 'error' as const;
    default: return 'neutral' as const;
  }
}

export default function ExpensesScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: true; data: Expense[]; meta: unknown }>('/expenses', {
        params: { limit: 50 },
      });
      return res.data;
    },
  });

  const renderItem = ({ item }: { item: Expense }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <Text style={styles.category}>{item.categoryName}</Text>
          <Text style={styles.description} numberOfLines={1}>{item.description}</Text>
          {item.payeeName && <Text style={styles.payee}>{item.payeeName}</Text>}
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.amount}>₹{parseFloat(item.amount).toLocaleString('en-IN')}</Text>
          <Text style={styles.date}>
            {new Date(item.expenseDate).toLocaleDateString('en-IN')}
          </Text>
          <StatusBadge label={item.status} variant={expenseStatusVariant(item.status)} size="sm" />
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Expenses" />
      {isLoading ? (
        <LoadingState message="Loading expenses..." />
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
              icon="wallet-outline"
              title="No expenses recorded"
              description="Society expenses will appear here once added."
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
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  category: { ...typography.labelLarge, color: colors.primary },
  description: { ...typography.bodyMedium, color: colors.text },
  payee: { ...typography.bodySmall, color: colors.textSecondary },
  amount: { ...typography.headingSmall, color: colors.text },
  date: { ...typography.bodySmall, color: colors.textSecondary },
});
