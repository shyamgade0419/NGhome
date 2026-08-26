import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { paymentsApi } from '@/api/endpoints/payments.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, paymentStatusVariant } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { PaymentSubmission } from '@/types/billing.types';

export default function ResidentPaymentsScreen() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['my-payments'],
    queryFn: () => paymentsApi.getMyPayments({ limit: 30 }),
  });

  const renderItem = ({ item }: { item: PaymentSubmission }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View>
          <Text style={styles.amount}>₹{parseFloat(item.amount).toLocaleString('en-IN')}</Text>
          <Text style={styles.date}>
            {new Date(item.paymentDate).toLocaleDateString('en-IN')} ·{' '}
            {item.paymentMethod.replace(/_/g, ' ')}
          </Text>
        </View>
        <StatusBadge label={item.status} variant={paymentStatusVariant(item.status)} />
      </View>

      {item.referenceNumber && (
        <Text style={styles.ref}>UTR/Ref: {item.referenceNumber}</Text>
      )}

      {item.status === 'REJECTED' && item.reviewNotes && (
        <View style={styles.rejectedNote}>
          <Ionicons name="alert-circle" size={14} color={colors.error} />
          <Text style={styles.rejectedText}>{item.reviewNotes}</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My Payments" />
      <View style={styles.newPaymentBar}>
        <Button
          label="I've Made a Payment"
          onPress={() => router.push('/(app)/resident/payments/submit')}
          fullWidth
          size="md"
          icon={<Ionicons name="add-circle-outline" size={18} color={colors.textInverse} />}
        />
      </View>

      {isLoading ? (
        <LoadingState message="Loading payments..." />
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
              icon="card-outline"
              title="No payments submitted"
              description="Tap 'I've Made a Payment' to submit your maintenance payment for verification."
              actionLabel="Submit Payment"
              onAction={() => router.push('/(app)/resident/payments/submit')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  newPaymentBar: {
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  list: { padding: spacing.base },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  amount: { ...typography.headingMedium, color: colors.text },
  date: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  ref: { ...typography.bodySmall, color: colors.textSecondary, fontFamily: 'monospace' },
  rejectedNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.errorLight, padding: spacing.sm, borderRadius: radius.sm },
  rejectedText: { ...typography.bodySmall, color: colors.error, flex: 1 },
});
