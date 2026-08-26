import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { Announcement } from '@/types/society.types';

const PRIORITY_VARIANT: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = {
  URGENT: 'error',
  HIGH: 'warning',
  NORMAL: 'info',
  LOW: 'neutral',
};

export default function AnnouncementsScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => societiesApi.getAnnouncements({ limit: 50 }),
  });

  const renderItem = ({ item }: { item: Announcement }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <StatusBadge label={item.priority} variant={PRIORITY_VARIANT[item.priority] ?? 'neutral'} size="sm" />
      </View>
      <Text style={styles.content} numberOfLines={3}>{item.content}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.audience}>{item.audience.replace(/_/g, ' ')}</Text>
        <Text style={styles.date}>
          {item.publishAt ? new Date(item.publishAt).toLocaleDateString('en-IN') : '—'}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Announcements" />
      {isLoading ? (
        <LoadingState message="Loading announcements..." />
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
              icon="megaphone-outline"
              title="No announcements"
              description="Society announcements will appear here."
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  title: { ...typography.headingSmall, color: colors.text, flex: 1 },
  content: { ...typography.bodyMedium, color: colors.textSecondary, lineHeight: 22 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  audience: { ...typography.labelMedium, color: colors.primary },
  date: { ...typography.bodySmall, color: colors.textSecondary },
});
