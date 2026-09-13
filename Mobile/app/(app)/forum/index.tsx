import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Modal, TextInput, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forumApi, ForumTopic } from '@/api/endpoints/forum.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

function NewTopicModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const mutation = useMutation({
    mutationFn: () => forumApi.create({ title: title.trim(), body: body.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum-topics'] });
      setTitle(''); setBody('');
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      Alert.alert('Could not post', e?.response?.data?.message ?? 'Please try again.'),
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Topic</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Should we upgrade the gym equipment?"
            placeholderTextColor={colors.textTertiary}
            value={title}
            onChangeText={setTitle}
            maxLength={150}
          />

          <Text style={styles.fieldLabel}>What&apos;s on your mind?</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Share the details…"
            placeholderTextColor={colors.textTertiary}
            value={body}
            onChangeText={setBody}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            maxLength={5000}
          />

          <Button
            label="Post Topic"
            onPress={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={title.trim().length < 3 || !body.trim()}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function TopicCard({ topic }: { topic: ForumTopic }) {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => router.push(`/(app)/forum/${topic.id}` as any)}
    >
      <View style={styles.cardTop}>
        {topic.isPinned && <Ionicons name="pin" size={14} color={colors.warning} style={{ marginTop: 2 }} />}
        <Text style={styles.cardTitle} numberOfLines={2}>{topic.title}</Text>
        {topic.isLocked && <Ionicons name="lock-closed" size={14} color={colors.textTertiary} style={{ marginTop: 2 }} />}
      </View>
      <Text style={styles.cardBody} numberOfLines={2}>{topic.body}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.cardMeta}>
          {topic.createdBy.firstName} {topic.createdBy.lastName} · {new Date(topic.createdAt).toLocaleDateString('en-IN')}
        </Text>
        <View style={styles.replyCount}>
          <Ionicons name="chatbubble-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.replyCountText}>{topic._count.replies}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ForumScreen() {
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['forum-topics'],
    queryFn: () => forumApi.list({ limit: 50 }),
  });

  const topics: ForumTopic[] = data?.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Community Board"
        rightAction={
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowNew(true)} hitSlop={8}>
            <Ionicons name="add" size={22} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <NewTopicModal visible={showNew} onClose={() => setShowNew(false)} />

      {isLoading ? (
        <LoadingState />
      ) : topics.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No topics yet"
          description="Start a discussion — festival planning, a question for the committee, anything the society should weigh in on."
          actionLabel="New Topic"
          onAction={() => setShowNew(true)}
        />
      ) : (
        <FlatList
          data={topics}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item }) => <TopicCard topic={item} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.sm, paddingBottom: spacing['4xl'] },
  addBtn: { padding: spacing.xs },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  cardTitle: { ...typography.labelLarge, color: colors.text, flex: 1 },
  cardBody: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  cardMeta: { ...typography.bodySmall, color: colors.textTertiary },
  replyCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyCountText: { ...typography.labelSmall, color: colors.textSecondary },

  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalScroll: { flex: 1 },
  modalContent: { padding: spacing.base, gap: spacing.base, paddingBottom: spacing['4xl'] },
  fieldLabel: { ...typography.labelLarge, color: colors.text, marginBottom: -spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, ...typography.bodyMedium, color: colors.text, backgroundColor: colors.surface,
  },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
});
