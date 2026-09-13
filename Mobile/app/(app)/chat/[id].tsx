import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi, ChatMessage } from '@/api/endpoints/chat.api';
import { useCurrentUser } from '@/hooks/useAuth';
import { colors, spacing, typography, radius } from '@/theme';

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export default function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const currentUser = useCurrentUser();
  const [draft, setDraft] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['chat-messages', id],
    queryFn: () => chatApi.listMessages(id, { limit: 50 }),
    enabled: !!id,
    // Refresh-based chat: poll for new messages while the thread is open,
    // rather than a live socket connection.
    refetchInterval: 10000,
  });

  // API returns newest-first (for cheap "last N" pagination); the thread
  // reads top-to-bottom like every other message UI.
  const messages: ChatMessage[] = [...(data?.data ?? [])].reverse();

  useEffect(() => {
    if (id) chatApi.markRead(id).catch(() => {});
  }, [id]);

  const send = useMutation({
    mutationFn: () => chatApi.sendMessage(id, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['chat-messages', id] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });

  const otherName = messages.find((m) => m.senderId !== currentUser?.id)?.sender;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {otherName ? `${otherName.firstName} ${otherName.lastName}` : 'Conversation'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.body}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 && (
              <Text style={styles.emptyHint}>No messages yet. Say hello!</Text>
            )}
            {messages.map((m) => {
              const mine = m.senderId === currentUser?.id;
              return (
                <View key={m.id} style={[styles.bubble, mine ? styles.myBubble : styles.otherBubble]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.body}</Text>
                  <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{when(m.createdAt)}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={4000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.sendBtnDisabled]}
            onPress={() => send.mutate()}
            disabled={!draft.trim() || send.isPending}
            accessibilityLabel="Send message"
          >
            {send.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Ionicons name="send" size={18} color={colors.textInverse} />
            )}
          </TouchableOpacity>
        </View>
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

  body: { padding: spacing.base, gap: spacing.sm },
  emptyHint: { ...typography.bodySmall, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.lg },

  bubble: { maxWidth: '80%', paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.lg },
  myBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  otherBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { ...typography.bodyMedium, color: colors.text, lineHeight: 21 },
  bubbleTextMine: { color: colors.textInverse },
  bubbleTime: { ...typography.labelSmall, color: colors.textTertiary, marginTop: 3, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.75)' },

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
});
