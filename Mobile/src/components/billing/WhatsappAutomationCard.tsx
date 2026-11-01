import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { whatsappApi } from '@/api/endpoints/whatsapp.api';
import { Button } from '@/components/ui/Button';
import { useIsSocietyAdmin } from '@/hooks/useAuth';
import { colors, radius, spacing, typography } from '@/theme';
import { WHATSAPP_KIND_LABEL, parseReminderDays } from '@/utils/reminders';

/**
 * WhatsApp that sends itself: when the bills are published, as a reminder on chosen days if a flat has not paid,
 * when a late fine is added, and when a payment is received. The admin switches it on and picks the reminder days;
 * the connection to WhatsApp itself is the platform's, set up once on the server.
 */
export function WhatsappAutomationCard() {
  const qc = useQueryClient();
  const isAdmin = useIsSocietyAdmin();
  const { data: status } = useQuery({ queryKey: ['whatsapp-status'], queryFn: whatsappApi.status });
  const { data: messages } = useQuery({ queryKey: ['whatsapp-messages'], queryFn: () => whatsappApi.messages(12) });

  // null = not edited yet: show what the server has, so a refetch cannot throw away what is being typed.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  useEffect(() => {
    setEnabled(null);
    setDays(null);
  }, [status?.enabled, status?.reminderDays?.join(',')]);

  const shownEnabled = enabled ?? status?.enabled ?? false;
  const shownDays = days ?? (status?.reminderDays ?? [5, 10]).join(', ');
  const dirty = enabled !== null || days !== null;

  const save = useMutation({
    mutationFn: () => whatsappApi.saveSettings({ enabled: shownEnabled, reminderDays: parseReminderDays(shownDays) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      qc.invalidateQueries({ queryKey: ['society-config-mobile'] });
      Alert.alert('Saved', shownEnabled ? 'WhatsApp messages will be sent automatically.' : 'Automatic WhatsApp messages are off.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Could not save the WhatsApp settings.'),
  });

  const test = useMutation({
    mutationFn: () => whatsappApi.test(testPhone),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-messages'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      if (r.sent) Alert.alert('Test sent', 'Check that phone for the message.');
      else Alert.alert('Not sent', r.error ?? 'The test message could not be sent.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'The test message could not be sent.'),
  });

  let line: { text: string; color: string };
  if (!status) line = { text: 'Checking the WhatsApp connection…', color: colors.textSecondary };
  else if (!status.configured)
    line = { text: 'WhatsApp is not connected yet. The platform owner links a phone once, in the web Platform console under Settings; until then nothing is sent.', color: colors.warning };
  else if (status.session === 'ready')
    line = {
      text: `Connected${status.sendingFrom ? ` — sending from +${status.sendingFrom}` : ''}. ${status.sentToday} sent today, ${status.queued} waiting${status.failedThisWeek ? `, ${status.failedThisWeek} failed this week` : ''}.`,
      color: '#166534',
    };
  else line = { text: `WhatsApp is not ready (${status.session ?? status.problem ?? 'unknown'}). Messages wait and go out once it reconnects.`, color: colors.warning };

  return (
    <View style={s.wrap}>
      <Text style={s.help}>
        Sends WhatsApp messages by itself: when bills are published, as a reminder if a flat has not paid, when a late fine
        is added, and when a payment is received. They go to the tenant when the flat has one, otherwise the owner, one at a
        time between 9 am and 8 pm.
      </Text>
      <Text style={[s.status, { color: line.color }]} accessibilityLabel="WhatsApp connection status">{line.text}</Text>

      <View style={s.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Send WhatsApp messages automatically</Text>
          <Text style={s.hint}>Off until you switch it on. Turning it off stops anything still waiting.</Text>
        </View>
        <Switch
          value={shownEnabled}
          onValueChange={setEnabled}
          disabled={!isAdmin || (status ? !status.configured : false)}
          trackColor={{ false: colors.border, true: colors.primary }}
          accessibilityLabel="Send WhatsApp messages automatically"
        />
      </View>

      <Text style={s.label}>Send reminders on these days of the month</Text>
      <TextInput
        style={s.input}
        value={shownDays}
        onChangeText={setDays}
        placeholder="5, 10"
        placeholderTextColor={colors.textTertiary}
        editable={isAdmin}
        accessibilityLabel="Reminder days"
      />
      <Text style={s.hint}>
        Days 1 to 28, separated by commas. Only flats that have not paid are reminded, once a day. The late-fine message goes
        out when the fine is actually added: the day after the due date plus the grace days. Set grace days to 0 for the 11th.
      </Text>

      {isAdmin && (
        <>
          <Button label={save.isPending ? 'Saving…' : 'Save WhatsApp Settings'} onPress={() => save.mutate()} loading={save.isPending} disabled={!dirty} fullWidth size="lg" />

          <Text style={s.label}>Send a test message to</Text>
          <View style={s.testRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={testPhone}
              onChangeText={setTestPhone}
              keyboardType="phone-pad"
              placeholder="98765 43210"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Test phone number"
            />
            <Button
              label="Send test"
              onPress={() => test.mutate()}
              loading={test.isPending}
              disabled={testPhone.replace(/\D/g, '').length < 8 || !status?.configured}
              variant="outline"
            />
          </View>
        </>
      )}

      {(messages ?? []).length > 0 && (
        <View>
          <Text style={s.label}>Latest messages</Text>
          {(messages ?? []).map((m) => (
            <View key={m.id} style={s.msgRow}>
              <Text style={s.msgText} numberOfLines={1}>{WHATSAPP_KIND_LABEL[m.kind] ?? m.kind} · +{m.toPhone}</Text>
              <Text style={[s.msgStatus, { color: m.status === 'SENT' ? '#166534' : m.status === 'FAILED' ? colors.error : colors.warning }]}>
                {m.status === 'SENT' ? 'Sent' : m.status === 'FAILED' ? 'Failed' : 'Waiting'}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.md },
  help: { ...typography.bodySmall, color: colors.textSecondary },
  status: { ...typography.bodySmall, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.secondaryLight },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { ...typography.labelLarge, color: colors.text },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, ...typography.bodyMedium, color: colors.text,
  },
  testRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  msgRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.xs },
  msgText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  msgStatus: { ...typography.labelMedium },
});
