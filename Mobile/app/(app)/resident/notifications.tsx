import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, Notification } from '@/api/endpoints/notifications.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography } from '@/theme';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function NotifRow({ item }: { item: Notification }) {
  const qc = useQueryClient();

  const markRead = useMutation({
    mutationFn: () => notificationsApi.markRead(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resident-notifications'] }),
  });

  const handlePress = () => {
    if (!item.isRead) markRead.mutate();
  };

  return (
    <TouchableOpacity
      style={[styles.row, !item.isRead && styles.rowUnread]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Unread dot */}
      <View style={[styles.dot, item.isRead && styles.dotRead]} />

      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={[styles.title, !item.isRead && styles.titleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
        </View>
        <Text style={styles.message} numberOfLines={3}>
          {item.message}
        </Text>
        {item.sentByName && (
          <Text style={styles.sender}>
            <Ionicons name="person-outline" size={11} color={colors.textTertiary} /> {item.sentByName}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ResidentNotificationsScreen() {
  const qc = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['resident-notifications'],
    queryFn: () => notificationsApi.getMine({ limit: 40, page: 1 }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = (data?.data ?? []).filter((n) => !n.isRead);
      await Promise.all(unread.map((n) => notificationsApi.markRead(n.id)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resident-notifications'] }),
  });

  const notifications: Notification[] = data?.data ?? [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Notifications"
        showBack
        rightAction={
          unreadCount > 0 ? (
            <TouchableOpacity onPress={() => markAllRead.mutate()} hitSlop={8}>
              <Ionicons name="checkmark-done-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingState fullscreen message="Loading notifications…" />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          renderItem={({ item }) => <NotifRow item={item} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <EmptyState
              icon="notifications-outline"
              title="All caught up"
              description="No notifications from your society yet."
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  rowUnread: { backgroundColor: colors.primaryLight + '55' },
  sep: { height: 1, backgroundColor: colors.borderLight },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
    flexShrink: 0,
  },
  dotRead: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },

  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { flex: 1, ...typography.bodyMedium, color: colors.textSecondary },
  titleUnread: { color: colors.text, fontWeight: '600' },
  time: { ...typography.labelSmall, color: colors.textTertiary, flexShrink: 0 },
  message: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 18 },
  sender: { ...typography.labelSmall, color: colors.textTertiary, marginTop: 2 },
});
