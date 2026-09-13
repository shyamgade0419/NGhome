import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { chatApi, ConversationSummary } from '@/api/endpoints/chat.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography } from '@/theme';

function initials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function ConversationRow({ item }: { item: ConversationSummary }) {
  const name = item.otherUser ? `${item.otherUser.firstName} ${item.otherUser.lastName}` : 'Unknown resident';
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.85}
      onPress={() => router.push(`/(app)/chat/${item.conversationId}` as any)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(item.otherUser?.firstName, item.otherUser?.lastName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, item.hasUnread && styles.nameUnread]} numberOfLines={1}>{name}</Text>
          <Text style={styles.time}>{item.lastMessage ? relativeTime(item.lastMessage.createdAt) : ''}</Text>
        </View>
        <Text style={[styles.preview, item.hasUnread && styles.previewUnread]} numberOfLines={1}>
          {item.lastMessage?.body ?? 'No messages yet'}
        </Text>
      </View>
      {item.hasUnread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

export default function ChatListScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => chatApi.listConversations(),
    // Refresh-based chat: no live socket, so the inbox polls periodically
    // to pick up new conversations/messages while it's open.
    refetchInterval: 15000,
  });

  const conversations = data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Messages"
        rightAction={
          <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/(app)/directory' as any)} hitSlop={8}>
            <Ionicons name="create-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="No conversations yet"
          description="Message a neighbor from the Directory to start one."
          actionLabel="Open Directory"
          onAction={() => router.push('/(app)/directory' as any)}
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.conversationId}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item }) => <ConversationRow item={item} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  newBtn: { padding: spacing.xs },
  list: { paddingHorizontal: spacing.base, paddingBottom: spacing['4xl'] },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: 60 },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.labelMedium, color: colors.primary },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  name: { ...typography.labelLarge, color: colors.text, flex: 1 },
  nameUnread: { fontWeight: '700' },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  preview: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  previewUnread: { color: colors.text, fontWeight: '600' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginLeft: spacing.xs },
});
