import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forumApi, ForumReply } from '@/api/endpoints/forum.api';
import { LoadingState } from '@/components/ui/LoadingState';
import { useCurrentUser, useIsRole } from '@/hooks/useAuth';
import { colors, spacing, typography, radius } from '@/theme';

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function ForumTopicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const currentUser = useCurrentUser();
  const isModerator = useIsRole('SOCIETY_ADMIN', 'COMMITTEE_MEMBER');
  const [draft, setDraft] = useState('');

  const { data: topic, isLoading } = useQuery({
    queryKey: ['forum-topic', id],
    queryFn: () => forumApi.get(id),
    enabled: !!id,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['forum-topic', id] });
    qc.invalidateQueries({ queryKey: ['forum-topics'] });
  };

  const reply = useMutation({
    mutationFn: () => forumApi.reply(id, draft.trim()),
    onSuccess: () => { setDraft(''); invalidateAll(); },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      Alert.alert('Could not send', e?.response?.data?.message ?? 'Please try again.'),
  });

  const pin = useMutation({ mutationFn: (next: boolean) => forumApi.pin(id, next), onSuccess: invalidateAll });
  const lock = useMutation({ mutationFn: (next: boolean) => forumApi.lock(id, next), onSuccess: invalidateAll });

  const remove = useMutation({
    mutationFn: () => forumApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum-topics'] });
      router.back();
    },
    onError: () => Alert.alert('Could not remove', 'Please try again.'),
  });

  const confirmRemove = () => {
    Alert.alert('Remove this topic?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate() },
    ]);
  };

  if (isLoading || !topic) return <LoadingState />;

  const canManage = isModerator || topic.createdBy.id === currentUser?.id;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Topic</Text>
        {canManage ? (
          <TouchableOpacity onPress={confirmRemove} hitSlop={12}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 20 }} />
        )}
      </View>

      {isModerator && (
        <View style={styles.modBar}>
          <TouchableOpacity style={styles.modBtn} onPress={() => pin.mutate(!topic.isPinned)}>
            <Ionicons name={topic.isPinned ? 'pin' : 'pin-outline'} size={15} color={colors.warning} />
            <Text style={styles.modBtnText}>{topic.isPinned ? 'Unpin' : 'Pin'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modBtn} onPress={() => lock.mutate(!topic.isLocked)}>
            <Ionicons name={topic.isLocked ? 'lock-open-outline' : 'lock-closed-outline'} size={15} color={colors.textSecondary} />
            <Text style={styles.modBtnText}>{topic.isLocked ? 'Unlock' : 'Lock'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={styles.opCard}>
            <Text style={styles.opTitle}>{topic.title}</Text>
            <Text style={styles.opMeta}>
              {topic.createdBy.firstName} {topic.createdBy.lastName} · {when(topic.createdAt)}
            </Text>
            <Text style={styles.opBody}>{topic.body}</Text>
          </View>

          {topic.replies.map((r: ForumReply) => {
            const mine = r.author.id === currentUser?.id;
            return (
              <View key={r.id} style={[styles.bubble, mine ? styles.myBubble : styles.otherBubble]}>
                <Text style={styles.bubbleAuthor}>
                  {mine ? 'You' : `${r.author.firstName} ${r.author.lastName}`} · {when(r.createdAt)}
                </Text>
                <Text style={styles.bubbleText}>{r.body}</Text>
              </View>
            );
          })}

          {topic.replies.length === 0 && (
            <Text style={styles.emptyHint}>No replies yet. Be the first to weigh in.</Text>
          )}
        </ScrollView>

        {topic.isLocked ? (
          <View style={styles.lockedBar}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.lockedText}>This topic is locked and no longer accepting replies.</Text>
          </View>
        ) : (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a reply…"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || reply.isPending) && styles.sendBtnDisabled]}
              onPress={() => reply.mutate()}
              disabled={!draft.trim() || reply.isPending}
              accessibilityLabel="Send reply"
            >
              {reply.isPending ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Ionicons name="send" size={18} color={colors.textInverse} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  headerTitle: { ...typography.headingSmall, color: colors.text, flex: 1, textAlign: 'center' },
  modBar: {
    flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modBtnText: { ...typography.labelSmall, color: colors.textSecondary },

  body: { padding: spacing.base, gap: spacing.sm },
  opCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: 6, marginBottom: spacing.sm,
  },
  opTitle: { ...typography.headingSmall, color: colors.text },
  opMeta: { ...typography.bodySmall, color: colors.textTertiary },
  opBody: { ...typography.bodyMedium, color: colors.text, lineHeight: 21, marginTop: 4 },

  bubble: { maxWidth: '85%', paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.lg },
  myBubble: { alignSelf: 'flex-end', backgroundColor: colors.primaryLight, borderBottomRightRadius: 4 },
  otherBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleAuthor: { ...typography.labelSmall, color: colors.textSecondary, marginBottom: 3 },
  bubbleText: { ...typography.bodyMedium, color: colors.text, lineHeight: 21 },
  emptyHint: { ...typography.bodySmall, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.lg },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  input: {
    flex: 1, maxHeight: 120, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 10, ...typography.bodyMedium, color: colors.text,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  lockedBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  lockedText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
});
