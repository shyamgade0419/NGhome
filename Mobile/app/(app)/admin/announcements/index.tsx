import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  TextInput,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography, radius } from '@/theme';
import { Announcement } from '@/types/society.types';

const PRIORITY_VARIANT: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = {
  URGENT: 'error',
  HIGH: 'warning',
  NORMAL: 'info',
  LOW: 'neutral',
};

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
type Priority = typeof PRIORITIES[number];

// ── Compose Modal ─────────────────────────────────────────────────────────────
function ComposeModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', content: '', priority: 'NORMAL' as Priority });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post('/announcements', {
        title: form.title.trim(),
        content: form.content.trim(),
        priority: form.priority,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
      Alert.alert('Published', 'Announcement sent to all residents.');
      onClose();
      setForm({ title: '', content: '', priority: 'NORMAL' });
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to post announcement.'),
  });

  const canSubmit = form.title.trim().length > 0 && form.content.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.safe} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <Text style={modal.title}>New Announcement</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={modal.content} keyboardShouldPersistTaps="handled">

            {/* Priority */}
            <Text style={modal.label}>Priority</Text>
            <View style={modal.priorityRow}>
              {PRIORITIES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    modal.priorityChip,
                    form.priority === p && modal.priorityChipActive,
                    p === 'URGENT' && form.priority === p && modal.chipUrgent,
                    p === 'HIGH'   && form.priority === p && modal.chipHigh,
                    p === 'LOW'    && form.priority === p && modal.chipLow,
                  ]}
                  onPress={() => setForm((f) => ({ ...f, priority: p }))}
                >
                  <Text
                    style={[
                      modal.priorityText,
                      form.priority === p && modal.priorityTextActive,
                    ]}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={modal.label}>Title *</Text>
            <TextInput
              style={modal.input}
              value={form.title}
              onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
              placeholder="Announcement headline"
              placeholderTextColor={colors.textTertiary}
              maxLength={150}
            />

            <Text style={modal.label}>Message *</Text>
            <TextInput
              style={[modal.input, modal.textarea]}
              value={form.content}
              onChangeText={(v) => setForm((f) => ({ ...f, content: v }))}
              placeholder="Full announcement text…"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />

            <Button
              label={mutation.isPending ? 'Publishing…' : 'Publish Announcement'}
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

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AnnouncementsScreen() {
  const qc = useQueryClient();
  const [showCompose, setShowCompose] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => societiesApi.getAnnouncements({ limit: 50 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/announcements/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to delete.'),
  });

  const handleDelete = (item: Announcement) => {
    Alert.alert(
      'Delete Announcement',
      `Delete "${item.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(item.id),
        },
      ],
    );
  };

  const composeButton = (
    <TouchableOpacity
      onPress={() => setShowCompose(true)}
      hitSlop={8}
      style={{ padding: 4 }}
    >
      <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: Announcement }) => (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <StatusBadge label={item.priority} variant={PRIORITY_VARIANT[item.priority] ?? 'neutral'} size="sm" />
      </View>
      <Text style={styles.content} numberOfLines={4}>{item.content}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.audience}>{item.audience.replace(/_/g, ' ')}</Text>
        <View style={styles.footerRight}>
          <Text style={styles.date}>
            {item.publishAt ? new Date(item.publishAt).toLocaleDateString('en-IN') : '—'}
          </Text>
          <TouchableOpacity
            onPress={() => handleDelete(item)}
            hitSlop={8}
            style={styles.deleteBtn}
          >
            <Ionicons name="trash-outline" size={16} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Announcements" rightAction={composeButton} />
      {isLoading ? (
        <LoadingState message="Loading announcements…" />
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
              description="Tap + to post your first announcement."
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}
      <ComposeModal visible={showCompose} onClose={() => setShowCompose(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },
  card: { gap: spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  title: { ...typography.headingSmall, color: colors.text, flex: 1 },
  content: { ...typography.bodyMedium, color: colors.textSecondary, lineHeight: 22 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  audience: { ...typography.labelMedium, color: colors.primary },
  date: { ...typography.bodySmall, color: colors.textSecondary },
  deleteBtn: { padding: 4 },
});

const modal = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { ...typography.headingSmall, color: colors.text, fontWeight: '700' },
  content: { padding: spacing.base, gap: spacing.sm },

  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  textarea: { minHeight: 120, textAlignVertical: 'top' },

  priorityRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm, flexWrap: 'wrap' },
  priorityChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  priorityChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipUrgent: { backgroundColor: '#fef2f2', borderColor: '#dc2626' },
  chipHigh:   { backgroundColor: '#fffbeb', borderColor: '#d97706' },
  chipLow:    { backgroundColor: '#f0fdf4', borderColor: '#16a34a' },
  priorityText: { ...typography.labelMedium, color: colors.textSecondary },
  priorityTextActive: { color: '#fff' },
});
