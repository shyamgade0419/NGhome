import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { billingApi } from '@/api/endpoints/billing.api';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { previewReminder } from '@/utils/reminders';

/** One piece of wording: the text, the details that can be put in it, how it looks for one flat, and a way back to the standard. */
function WordingBox({
  title, help, value, onChange, standard, placeholders, inputLabel, resetLabel,
}: {
  title?: string;
  help: string;
  value: string;
  onChange: (next: string) => void;
  standard: string;
  placeholders: { token: string; meaning: string }[];
  inputLabel: string;
  resetLabel: string;
}) {
  const add = (token: string) => onChange(`${value}${value && !/\s$/.test(value) ? ' ' : ''}${token}`);
  return (
    <View style={s.wrap}>
      {title ? <Text style={s.title}>{title}</Text> : null}
      <Text style={s.help}>{help}</Text>
      <View style={s.chips}>
        {placeholders.map((p) => (
          <TouchableOpacity key={p.token} style={s.chip} onPress={() => add(p.token)} accessibilityLabel={`Add ${p.token}: ${p.meaning}`}>
            <Text style={s.chipText}>{p.token}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        multiline
        textAlignVertical="top"
        maxLength={1500}
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel={inputLabel}
      />
      <Text style={s.previewLabel}>How it looks for one flat</Text>
      <View style={s.preview}>
        <Text style={s.previewText}>{previewReminder(value) || 'Nothing yet: the standard wording will be used.'}</Text>
      </View>
      {value.trim() !== standard.trim() && (
        <TouchableOpacity onPress={() => onChange(standard)} accessibilityLabel={resetLabel}>
          <Text style={s.reset}>Go back to the standard wording</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * The wording of the payment reminders sent on WhatsApp. There are two: the first reminder a flat gets about its bill, and a
 * second one, sent on a later reminder day to a flat that was already reminded and has still not paid. Each is written once;
 * every unpaid flat gets its own name, flat number and amount filled in. A wording that matches the standard is saved as
 * "unset", so the society follows the standard if it is ever improved.
 */
export function ReminderTemplateEditor() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['reminder-template'], queryFn: billingApi.getReminderTemplate });
  // null = not edited yet: show what the server has. Kept apart so a refetch cannot throw away a half-written message.
  const [firstDraft, setFirstDraft] = useState<string | null>(null);
  const [secondDraft, setSecondDraft] = useState<string | null>(null);
  const first = firstDraft ?? data?.template ?? '';
  // An older server does not know the second reminder: then there is nothing to show or save for it.
  const hasSecond = data?.finalTemplate !== undefined && data?.defaultFinalTemplate !== undefined;
  const second = secondDraft ?? data?.finalTemplate ?? '';

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch('/societies/my/config', {
        ...(firstDraft !== null ? { reminderTemplate: first.trim() === data?.defaultTemplate.trim() ? '' : first.trim() } : {}),
        ...(secondDraft !== null && hasSecond ? { finalReminderTemplate: second.trim() === data?.defaultFinalTemplate?.trim() ? '' : second.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminder-template'] });
      qc.invalidateQueries({ queryKey: ['billing-period-reminders'] });
      setFirstDraft(null);
      setSecondDraft(null);
      Alert.alert('Saved', 'The reminder wording is updated.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Could not save the reminder wording.'),
  });

  return (
    <View style={s.outer}>
      <WordingBox
        title={hasSecond ? 'First reminder' : undefined}
        help={`The message sent to a flat that has not paid, with that flat's details filled in. It goes to the tenant when the flat has one, otherwise to the owner. WhatsApp shows *text* in bold and _text_ in italics.`}
        value={first}
        onChange={setFirstDraft}
        standard={data?.defaultTemplate ?? ''}
        placeholders={data?.placeholders ?? []}
        inputLabel="Reminder message"
        resetLabel="Go back to the standard wording"
      />
      {hasSecond && (
        <WordingBox
          title="Second reminder"
          help="Sent on a later reminder day to a flat that was already reminded about this bill and still has not paid. A flat reminded for the first time always gets the first wording, whichever day it is."
          value={second}
          onChange={setSecondDraft}
          standard={data?.defaultFinalTemplate ?? ''}
          placeholders={data?.placeholders ?? []}
          inputLabel="Second reminder message"
          resetLabel="Go back to the standard second reminder"
        />
      )}
      <Button label={save.isPending ? 'Saving…' : 'Save Reminder Wording'} onPress={() => save.mutate()} loading={save.isPending} disabled={firstDraft === null && secondDraft === null} fullWidth size="lg" />
    </View>
  );
}

const s = StyleSheet.create({
  outer: { gap: spacing.lg },
  wrap: { gap: spacing.md },
  title: { ...typography.headingSmall, color: colors.text },
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
