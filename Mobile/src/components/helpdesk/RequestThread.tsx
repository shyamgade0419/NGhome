/**
 * The conversation on one helpdesk request, used by both the resident and
 * the admin screens.
 *
 * Requests were one-way: a resident raised one and could only watch the
 * status change, with a single adminNotes field as the whole channel back.
 * This is the two-way version — both sides post into one thread.
 *
 * Laid out by who raised the request, not by who is looking: the resident's
 * lines sit on the right for everyone. That keeps the thread reading the same
 * way on both screens, so an admin describing it to a resident, or the other
 * way round, is talking about the same picture.
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { helpdeskApi, MaintenanceRequest, RequestComment } from '@/api/endpoints/helpdesk.api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';

function statusVariant(status: string) {
  switch (status) {
    case 'RESOLVED': return 'success' as const;
    case 'CLOSED': return 'neutral' as const;
    case 'IN_PROGRESS': return 'info' as const;
    default: return 'warning' as const;
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export function RequestThread({
  request,
  onClose,
}: {
  request: MaintenanceRequest;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState('');

  const { data: comments, isLoading } = useQuery({
    queryKey: ['helpdesk-comments', request.id],
    queryFn: () => helpdeskApi.comments(request.id),
  });

  const send = useMutation({
    mutationFn: () => helpdeskApi.addComment(request.id, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['helpdesk-comments', request.id] });
      // The list screens key on 'helpdesk-mine' and 'helpdesk-admin'.
      qc.invalidateQueries({ queryKey: ['helpdesk-mine'] });
      qc.invalidateQueries({ queryKey: ['helpdesk-admin'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      Alert.alert('Could not send', e?.response?.data?.message ?? 'Please try again.'),
  });

  const closed = request.status === 'CLOSED';
  const thread: RequestComment[] = comments ?? [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>{request.title}</Text>
            <View style={styles.headerMeta}>
              <StatusBadge
                label={request.status.replace(/_/g, ' ')}
                variant={statusVariant(request.status)}
                size="sm"
              />
              {request.flat?.flatCode ? (
                <Text style={styles.metaText}>Flat {request.flat.flatCode}</Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.body}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {/* The original request is the first line of the conversation. */}
            <View style={[styles.bubble, styles.residentBubble]}>
              <Text style={styles.bubbleAuthor}>
                {request.resident
                  ? `${request.resident.firstName} ${request.resident.lastName}`
                  : 'Resident'}
                {' · '}{when(request.createdAt)}
              </Text>
              <Text style={styles.bubbleText}>
                {request.description?.trim() || request.title}
              </Text>
            </View>

            {request.adminNotes ? (
              <View style={[styles.bubble, styles.staffBubble]}>
                <Text style={styles.bubbleAuthor}>Society note</Text>
                <Text style={styles.bubbleText}>{request.adminNotes}</Text>
              </View>
            ) : null}

            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            ) : (
              thread.map((c) => (
                <View
                  key={c.id}
                  style={[styles.bubble, c.isFromResident ? styles.residentBubble : styles.staffBubble]}
                >
                  <Text style={styles.bubbleAuthor}>
                    {c.author.firstName} {c.author.lastName}
                    {c.isFromResident ? '' : ' · Society'}
                    {' · '}{when(c.createdAt)}
                  </Text>
                  <Text style={styles.bubbleText}>{c.body}</Text>
                </View>
              ))
            )}

            {!isLoading && thread.length === 0 && !request.adminNotes ? (
              <Text style={styles.emptyHint}>
                No replies yet. Anything you add here goes to the other side straight away.
              </Text>
            ) : null}
          </ScrollView>

          {closed ? (
            <View style={styles.closedBar}>
              <Ionicons name="lock-closed-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.closedText}>
                This request is closed. Raise a new one if the problem has come back.
              </Text>
            </View>
          ) : (
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Write a reply…"
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={2000}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.sendBtnDisabled]}
                onPress={() => send.mutate()}
                disabled={!draft.trim() || send.isPending}
                accessibilityLabel="Send reply"
              >
                {send.isPending ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Ionicons name="send" size={18} color={colors.textInverse} />
                )}
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { ...typography.headingSmall, color: colors.text },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  metaText: { ...typography.bodySmall, color: colors.textSecondary },

  body: { padding: spacing.base, gap: spacing.sm },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.lg,
  },
  residentBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primaryLight,
    borderBottomRightRadius: 4,
  },
  staffBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleAuthor: { ...typography.labelSmall, color: colors.textSecondary, marginBottom: 3 },
  bubbleText: { ...typography.bodyMedium, color: colors.text, lineHeight: 21 },
  emptyHint: {
    ...typography.bodySmall, color: colors.textTertiary,
    textAlign: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.lg,
  },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  closedBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  closedText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
});
