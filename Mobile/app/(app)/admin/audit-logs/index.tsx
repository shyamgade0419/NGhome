/**
 * Admin — Audit Logs
 *
 * Society-wide action history, newest first. Paginated by pulling successive
 * pages as the list is scrolled, because an audit trail grows without bound
 * and a fixed limit would quietly hide older entries.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { auditLogsApi, AuditLogEntry } from '@/api/endpoints/audit-logs.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography, radius } from '@/theme';

const PAGE_SIZE = 40;

/** Groups of actions that share an icon and tint. */
const ACTION_STYLE: Array<{ match: RegExp; icon: keyof typeof Ionicons.glyphMap; tint: string }> = [
  { match: /LOGIN|LOGOUT/, icon: 'log-in-outline', tint: colors.textSecondary },
  { match: /PAYMENT_APPROVED|EXPENSE_APPROVED/, icon: 'checkmark-circle-outline', tint: colors.success },
  { match: /REJECTED/, icon: 'close-circle-outline', tint: colors.error },
  { match: /BILL_/, icon: 'receipt-outline', tint: colors.primary },
  { match: /PAYMENT_/, icon: 'card-outline', tint: colors.primary },
  { match: /EXPENSE_/, icon: 'wallet-outline', tint: colors.warning },
  { match: /USER_/, icon: 'person-outline', tint: colors.info },
  { match: /CONFIG_CHANGED/, icon: 'settings-outline', tint: colors.info },
  { match: /PERIOD_CLOSED/, icon: 'lock-closed-outline', tint: colors.textSecondary },
  { match: /TRANSACTION/, icon: 'swap-horizontal-outline', tint: colors.primary },
];

function styleFor(action: string) {
  return (
    ACTION_STYLE.find((s) => s.match.test(action)) ?? {
      icon: 'ellipse-outline' as const,
      tint: colors.textTertiary,
    }
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AuditLogsScreen() {
  const [filter, setFilter] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['audit-logs', filter],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      auditLogsApi.list({ page: pageParam as number, limit: PAGE_SIZE, action: filter ?? undefined }),
    getNextPageParam: (lastPage, allPages) => {
      const rows = lastPage?.data?.length ?? 0;
      return rows < PAGE_SIZE ? undefined : allPages.length + 1;
    },
  });

  const logs: AuditLogEntry[] = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p?.data ?? []),
    [data],
  );

  const FILTERS = ['ALL', 'PAYMENT_APPROVED', 'BILL_PUBLISHED', 'EXPENSE_APPROVED', 'CONFIG_CHANGED'];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Audit Logs" showBack />

      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(f) => f}
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterContent}
        renderItem={({ item }) => {
          const active = item === 'ALL' ? filter === null : filter === item;
          return (
            <TouchableOpacity
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(item === 'ALL' ? null : item)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {item.replace(/_/g, ' ')}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {isLoading ? (
        <LoadingState message="Loading activity…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load logs" description="Pull down to retry." />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          onEndReachedThreshold={0.5}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => {
            const s = styleFor(item.action);
            const actor = item.actor ? `${item.actor.firstName} ${item.actor.lastName}` : 'System';
            return (
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: s.tint + '18' }]}>
                  <Ionicons name={s.icon} size={17} color={s.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.action}>{item.action.replace(/_/g, ' ')}</Text>
                  <Text style={styles.meta}>
                    {actor}
                    {item.entityType ? ` · ${item.entityType}` : ''}
                  </Text>
                </View>
                <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="shield-checkmark-outline"
              title="No activity"
              description={filter ? 'No entries match this filter.' : 'Society actions will be recorded here.'}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footerLoad}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={{ height: spacing['3xl'] }} />
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

  filterBar: {
    maxHeight: 48,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterContent: { paddingHorizontal: spacing.base, paddingVertical: 8, gap: 8 },
  chip: {
    paddingHorizontal: 13, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary, fontSize: 11 },
  chipTextActive: { color: '#fff' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.base, paddingVertical: spacing.md,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  action: { ...typography.labelMedium, color: colors.text, fontWeight: '600' },
  meta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  time: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11 },

  footerLoad: { paddingVertical: spacing.xl, alignItems: 'center' },
});
