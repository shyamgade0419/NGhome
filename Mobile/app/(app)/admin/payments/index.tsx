import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { paymentsApi } from '@/api/endpoints/payments.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, paymentStatusVariant } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { PaymentSubmission } from '@/types/billing.types';

const STATUS_FILTERS = ['ALL', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
type Filter = (typeof STATUS_FILTERS)[number];

export default function AdminPaymentsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('PENDING');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-payments', filter],
    queryFn: () =>
      paymentsApi.getAllPayments({
        status: filter === 'ALL' ? undefined : filter,
        limit: 50,
      }),
  });

  const openWhatsApp = (phone: string | null | undefined) => {
    if (!phone) return;
    const digits = phone.replace(/\D/g, '');
    const wa = digits.startsWith('91') ? digits : `91${digits}`;
    Linking.openURL(`https://wa.me/${wa}`).catch(() => {});
  };

  const renderItem = ({ item }: { item: PaymentSubmission }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/(app)/admin/payments/${item.id}` as any)}
      activeOpacity={0.8}
    >
      <View style={styles.cardTop}>
        <View style={styles.flatInfo}>
          <Text style={styles.flatNumber}>
            {item.flat?.flatCode ?? item.flatId}
            {item.user ? ` · ${item.user.firstName} ${item.user.lastName}` : ''}
          </Text>
          <Text style={styles.submittedAt}>
            {new Date(item.createdAt).toLocaleDateString('en-IN')}
          </Text>
        </View>
        <View style={styles.cardTopRight}>
          <StatusBadge label={item.status} variant={paymentStatusVariant(item.status)} />
          {(item.user as any)?.phone && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); openWhatsApp((item.user as any).phone); }}
              hitSlop={8}
              style={styles.waBtn}
            >
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.cardBottom}>
        <View>
          <Text style={styles.amount}>₹{parseFloat(item.amount).toLocaleString('en-IN')}</Text>
          <Text style={styles.method}>{item.paymentMethod.replace('_', ' ')}</Text>
        </View>
        {item.referenceNumber && (
          <Text style={styles.ref}>Ref: {item.referenceNumber}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payment Approvals" />

      <View style={styles.filterRow}>
        <FlatList
          horizontal
          data={STATUS_FILTERS}
          keyExtractor={(s) => s}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.filterChip, filter === item && styles.filterChipActive]}
              onPress={() => setFilter(item)}
            >
              <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
                {item}
              </Text>
            </TouchableOpacity>
          )}
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
              title={`No ${filter === 'ALL' ? '' : filter.toLowerCase()} payments`}
              description="Payment submissions will appear here for review."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filterRow: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterList: { paddingHorizontal: spacing.base, paddingVertical: spacing.md, gap: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  filterText: { ...typography.labelMedium, color: colors.textSecondary },
  filterTextActive: { color: colors.primary },

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
  cardTopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  waBtn: { padding: 2 },
  flatInfo: {},
  flatNumber: { ...typography.headingSmall, color: colors.text },
  submittedAt: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { ...typography.headingMedium, color: colors.primary },
  method: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  ref: { ...typography.bodySmall, color: colors.textSecondary, fontFamily: 'monospace' },
});
