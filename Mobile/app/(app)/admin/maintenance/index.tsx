import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, billingStatusVariant } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { BillingPeriod, billingPeriodName } from '@/types/billing.types';

export default function MaintenanceScreen() {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['billing-periods'],
    queryFn: () => billingApi.getBillingPeriods({ limit: 20 }),
  });

  const generateMutation = useMutation({
    mutationFn: billingApi.generateBills,
    onSuccess: (result, periodId) => {
      Alert.alert(
        'Bills Generated',
        `Generated: ${result.generated} bills\nErrors: ${result.errors}`,
      );
      queryClient.invalidateQueries({ queryKey: ['billing-periods'] });
    },
    onError: () => Alert.alert('Error', 'Failed to generate bills.'),
  });

  const publishMutation = useMutation({
    mutationFn: billingApi.publishPeriod,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-periods'] });
      Alert.alert('Published', 'Billing period published. Residents can now view their bills.');
    },
    onError: () => Alert.alert('Error', 'Failed to publish period.'),
  });

  const renderItem = ({ item }: { item: BillingPeriod }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <Text style={styles.periodName}>{billingPeriodName(item)}</Text>
          <Text style={styles.periodDue}>
            Due: {new Date(item.dueDate).toLocaleDateString('en-IN')}
          </Text>
        </View>
        <StatusBadge label={item.status} variant={billingStatusVariant(item.status)} />
      </View>

      <View style={styles.amountsRow}>
        <View style={styles.amount}>
          <Text style={styles.amountLabel}>Billed</Text>
          <Text style={[styles.amountValue, { color: colors.primary }]}>
            ₹{parseFloat(item.totalBilled).toLocaleString('en-IN')}
          </Text>
        </View>
        <View style={styles.amount}>
          <Text style={styles.amountLabel}>Collected</Text>
          <Text style={[styles.amountValue, { color: colors.secondary }]}>
            ₹{parseFloat(item.totalCollected).toLocaleString('en-IN')}
          </Text>
        </View>
        <View style={styles.amount}>
          <Text style={styles.amountLabel}>Outstanding</Text>
          <Text style={[styles.amountValue, { color: colors.warning }]}>
            ₹{parseFloat(item.totalPending).toLocaleString('en-IN')}
          </Text>
        </View>
      </View>

      {(item.status === 'DRAFT' || item.status === 'CALCULATED') && (
        <View style={styles.cardActions}>
          <Button
            label="Generate Bills"
            onPress={() =>
              Alert.alert('Generate Bills', `Generate bills for ${billingPeriodName(item)}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Generate', onPress: () => generateMutation.mutate(item.id) },
              ])
            }
            loading={generateMutation.isPending}
            variant="outline"
            size="sm"
            style={styles.flex1}
          />
          {item.status === 'CALCULATED' && (
            <Button
              label="Publish"
              onPress={() =>
                Alert.alert('Publish Period', 'Publish this billing period to residents?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Publish', onPress: () => publishMutation.mutate(item.id) },
                ])
              }
              loading={publishMutation.isPending}
              size="sm"
              style={styles.flex1}
            />
          )}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Billing & Maintenance" />
      {isLoading ? (
        <LoadingState message="Loading billing periods..." />
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
              title="No billing periods yet"
              description="Create your first billing period to start generating maintenance bills."
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: { flex: 1, marginRight: spacing.md },
  periodName: { ...typography.headingSmall, color: colors.text },
  periodDue: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  amountsRow: { flexDirection: 'row', gap: spacing.md },
  amount: { flex: 1, alignItems: 'center' },
  amountLabel: { ...typography.labelSmall, color: colors.textSecondary },
  amountValue: { ...typography.headingSmall, marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: spacing.md },
  flex1: { flex: 1 },
});
