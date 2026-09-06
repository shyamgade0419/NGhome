import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '@/api/endpoints/notifications.api';
import { colors } from '@/theme';

/**
 * The bell icon on both Home screens had nothing to indicate unread
 * notifications existed — the count was only ever computed inside the
 * notifications list itself (to show/hide "mark all read"), never
 * surfaced anywhere you'd actually notice it before opening the list.
 * Polls a lightweight count endpoint (not the full list) so this is cheap
 * enough to sit in a header. 60s is a compromise: fast enough to feel
 * responsive without hammering the API for something that isn't urgent
 * the moment it changes.
 */
export function NotificationBell({
  onPress,
  size = 22,
  color = colors.textSecondary,
}: {
  onPress: () => void;
  size?: number;
  color?: string;
}) {
  const { data: count = 0 } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: notificationsApi.getUnreadCount,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <TouchableOpacity onPress={onPress} hitSlop={8}>
      <View style={styles.wrap}>
        <Ionicons name="notifications-outline" size={size} color={color} />
        {count > 0 && <View style={styles.dot} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
