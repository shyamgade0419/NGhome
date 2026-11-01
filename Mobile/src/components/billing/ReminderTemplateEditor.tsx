import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { billingApi } from '@/api/endpoints/billing.api';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { previewReminder } from '@/utils/reminders';

/**
 * The wording of the payment reminder sent on WhatsApp. Written once; each unpaid flat gets its own name, flat
 * number and amount filled in. Saved as "unset" when it matches the standard wording, so the society follows the
 * standard wording if it is ever improved.
 */
export function ReminderTemplateEditor() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['reminder-template'], queryFn: billingApi.getReminderTemplate });
  // null = not edited yet: show what the server has. Kept apart so a refetch cannot throw away a half-written message.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? data?.template ?? '';

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch('/societies/my/config', {
        reminderTemplate: value.trim() === data?.defaultTemplate.trim() ? '' : value.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminder-template'] });
      qc.invalidateQueries({ queryKey: ['billing-period-reminders'] });
      setDraft(null);
      Alert.alert('Saved', 'The reminder wording is updated.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Could not save the reminder wording.'),
  });

  const add = (token: string) => setDraft(`${value}${value && !/\s$/.test(value) ? ' ' : ''}${token}`);

  return (
    <View style={s.wrap}>
      <Text style={s.help}>
        The message sent to a flat that has not paid, with that flat&apos;s details filled in. It goes to the tenant when
        the flat has one, otherwise to the owner. WhatsApp shows *text* in bold and _text_ in italics.
      </Text>
      <View style={s.chips}>
        {(data?.placeholders ?? []).map((p) => (
          <TouchableOpacity key={p.token} style={s.chip} onPress={() => add(p.token)} accessibilityLabel={`Add ${p.token}: ${p.meaning}`}>
            <Text style={s.chipText}>{p.token}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={setDraft}
        multiline
        textAlignVertical="top"
        maxLength={1500}
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel="Reminder message"
      />
      <Text style={s.previewLabel}>How it looks for one flat</Text>
      <View style={s.preview}>
        <Text style={s.previewText}>{previewReminder(value) || 'Nothing yet: the standard wording will be used.'}</Text>
      </View>
      {data && value.trim() !== data.defaultTemplate.trim() && (
        <TouchableOpacity onPress={() => setDraft(data.defaultTemplate)} accessibilityLabel="Go back to the standard wording">
          <Text style={s.reset}>Go back to the standard wording</Text>
        </TouchableOpacity>
      )}
      <Button label={save.isPending ? 'Saving…' : 'Save Reminder Wording'} onPress={() => save.mutate()} loading={save.isPending} disabled={draft === null} fullWidth size="lg" />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.md },
  help: { ...typography.bodySmall, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, borderWidth: 1, borderColor: '#25D366', backgroundColor: colors.secondaryLight },
  chipText: { ...typography.labelSmall, color: '#128C5E' },
  input: {
    minHeight: 170, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
    padding: spacing.md, ...typography.bodyMedium, color: colors.text,
  },
  previewLabel: { ...typography.labelMedium, color: colors.textSecondary },
  preview: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.secondaryLight, borderWidth: 1, borderColor: colors.borderLight },
  previewText: { ...typography.bodySmall, color: colors.text },
  reset: { ...typography.labelMedium, color: colors.primary, textDecorationLine: 'underline' },
});
