import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/api/endpoints/notifications.api';
import { Button } from '@/components/ui/Button';
import { AudiencePicker } from '@/components/notifications/AudiencePicker';
import { EVERYONE, AudienceChoice, choiceProblem, sendLabel, sentMessage, toPayload } from '@/notifications/audienceChoice';
import { colors, spacing, typography, radius } from '@/theme';

/**
 * Admin and staff: write a notification and choose who gets it: everyone, some buildings, some flats, the committee or the
 * staff. It arrives in each person's inbox and, when their phone is set up for alerts, as a phone alert. The same role gate
 * as the server's own on POST /notifications.
 */
export function ComposeNotification({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AudienceChoice>(EVERYONE);

  const mutation = useMutation({
    mutationFn: () => notificationsApi.send({ title: title.trim(), body: body.trim(), ...toPayload(audience) }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['resident-notifications'] });
      // The sender can be a recipient too, so their own bell badge should reflect it.
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      const done = sentMessage(result?.recipientCount);
      Alert.alert(done.title, done.message);
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to send notification.'),
  });

  const problem = choiceProblem(audience);
  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !problem;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.safe} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <Text style={modal.title}>Send Notification</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={modal.content} keyboardShouldPersistTaps="handled">
            <Text style={modal.label}>Send to</Text>
            <AudiencePicker value={audience} onChange={setAudience} />

            <Text style={modal.label}>Title *</Text>
            <TextInput
              style={modal.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Maintenance reminder"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Title"
            />

            <Text style={modal.label}>Message *</Text>
            <TextInput
              style={[modal.input, modal.textarea]}
              value={body}
              onChangeText={setBody}
              placeholder="Write your message…"
              placeholderTextColor={colors.textTertiary}
              multiline
              accessibilityLabel="Message"
            />

            {problem && title.trim() && body.trim() ? <Text style={modal.problem}>{problem}</Text> : null}

            <Button
              label={mutation.isPending ? 'Sending…' : sendLabel(audience)}
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
  problem: { ...typography.bodySmall, color: colors.error },
});
