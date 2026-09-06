import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, Notification } from '@/api/endpoints/notifications.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useIsRole } from '@/hooks/useAuth';
import { colors, spacing, typography, radius } from '@/theme';

// ── Compose (admin/staff only) ───────────────────────────────────────
// The backend endpoint (POST /notifications) and even this screen's API
// wrapper (notificationsApi.send) already existed — web has had a Compose
// button since the Notifications page was built. This was the only piece
// actually missing: a mobile UI to call it. Same role gate as web's
// canSend (SOCIETY_ADMIN or SOCIETY_STAFF; useIsRole already lets a
// platform admin through) and the backend's own @Roles on that endpoint.
function ComposeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const mutation = useMutation({
    mutationFn: () => notificationsApi.send({ title: title.trim(), body: body.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resident-notifications'] });
      // The sender is also a recipient now (see the backend fan-out fix) —
      // their own bell badge should reflect the new notification too.
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      Alert.alert('Sent', 'Notification sent to all society members.');
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to send notification.'),
  });

  const canSubmit = title.trim().length > 0 && body.trim().length > 0;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.safe} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <Text style={modal.title}>Send Notification</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={modal.content} keyboardShouldPersistTaps="handled">
            <Text style={modal.label}>Title *</Text>
            <TextInput
              style={modal.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Maintenance reminder"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={modal.label}>Message *</Text>
            <TextInput
              style={[modal.input, modal.textarea]}
              value={body}
              onChangeText={setBody}
              placeholder="Write your message to all society members..."
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <Button
              label={mutation.isPending ? 'Sending…' : 'Send to All Members'}
              onPress={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!canSubmit}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.md }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
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
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function NotifRow({ item }: { item: Notification }) {
  const qc = useQueryClient();

  const markRead = useMutation({
    mutationFn: () => notificationsApi.markRead(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resident-notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
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
  const canSend = useIsRole('SOCIETY_ADMIN', 'SOCIETY_STAFF');
  const [showCompose, setShowCompose] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['resident-notifications'],
    queryFn: () => notificationsApi.getMine({ limit: 40, page: 1 }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = (data?.data ?? []).filter((n) => !n.isRead);
      await Promise.all(unread.map((n) => notificationsApi.markRead(n.id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resident-notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const notifications: Notification[] = data?.data ?? [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Notifications"
        showBack
        rightAction={
          canSend || unreadCount > 0 ? (
            <View style={styles.headerActions}>
              {canSend && (
                <TouchableOpacity onPress={() => setShowCompose(true)} hitSlop={8}>
                  <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                </TouchableOpacity>
              )}
              {unreadCount > 0 && (
                <TouchableOpacity onPress={() => markAllRead.mutate()} hitSlop={8}>
                  <Ionicons name="checkmark-done-outline" size={22} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          ) : undefined
        }
      />

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}

      {isLoading ? (
        <LoadingState fullscreen message="Loading notifications…" />
      ) : isError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load notifications"
          description="Pull down to try again."
        />
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

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

const modal = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { ...typography.headingSmall, color: colors.text, fontWeight: '700' },
  content: { padding: spacing.base, gap: spacing.sm },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
});
