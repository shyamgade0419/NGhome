/**
 * My electricity: the company and consumer number of my flat's connection, and a reminder on the 8th of every month (or the day I
 * choose) to check and pay the bill. NG Home does not fetch the bill or take payment: the button opens the company's own website.
 * Only the people of this flat can see these numbers.
 */

import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from '@/components/layout/GlassSafeArea';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { utilitiesApi } from '@/api/endpoints/utilities.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { colors, radius, spacing, typography } from '@/theme';
import { DEFAULT_DAY, MAX_CONNECTIONS, OTHER, clampDay, dateText, isHttps, isValidNumber, ordinal, tidyNumber } from '@/utils/utilities';
import type { UtilityConnection } from '@/utils/utilities';

export default function ElectricityScreen() {
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: ['my-utilities'], queryFn: utilitiesApi.mine });
  const providers = useQuery({ queryKey: ['utility-providers'], queryFn: utilitiesApi.providers, staleTime: 60 * 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-utilities'] });

  // ── the add / edit sheet ───────────────────────────────────────────────────
  const [open, setOpen] = useState<'add' | UtilityConnection | null>(null);
  const [code, setCode] = useState('');
  const [otherName, setOtherName] = useState('');
  const [otherUrl, setOtherUrl] = useState('');
  const [number, setNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [day, setDay] = useState(DEFAULT_DAY);
  const editing = open !== null && open !== 'add' ? open : null;

  const openAdd = () => {
    setCode(''); setOtherName(''); setOtherUrl(''); setNumber(''); setNickname('');
    setDay(providers.data?.defaultReminderDay ?? DEFAULT_DAY);
    setOpen('add');
  };
  const openEdit = (c: UtilityConnection) => {
    setCode(c.providerCode); setOtherName(c.providerCode === OTHER ? c.providerName : ''); setOtherUrl(c.providerCode === OTHER ? c.providerUrl ?? '' : '');
    setNumber(c.consumerNumber); setNickname(c.nickname ?? ''); setDay(c.reminderDay);
    setOpen(c);
  };
  const close = () => setOpen(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        providerCode: code,
        ...(code === OTHER ? { providerName: otherName.trim(), ...(otherUrl.trim() ? { providerUrl: otherUrl.trim() } : {}) } : {}),
        consumerNumber: tidyNumber(number),
        nickname: nickname.trim(),
        reminderDay: day,
      };
      return editing ? utilitiesApi.update(editing.id, body) : utilitiesApi.create(body);
    },
    onSuccess: () => { refresh(); close(); },
    onError: (e) => Alert.alert('Could not save', apiErrorMessage(e, 'Please try again.')),
  });

  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => utilitiesApi.update(id, { remindersOn: on }),
    onSuccess: refresh,
    onError: (e) => Alert.alert('Could not change the reminder', apiErrorMessage(e, 'Please try again.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => utilitiesApi.remove(id),
    onSuccess: refresh,
    onError: (e) => Alert.alert('Could not remove it', apiErrorMessage(e, 'Please try again.')),
  });

  const confirmRemove = (c: UtilityConnection) =>
    Alert.alert('Remove this connection?', `${c.nickname || c.providerName}\nYou will stop getting its monthly reminder.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(c.id) },
    ]);

  const pay = (c: UtilityConnection) => {
    if (!isHttps(c.providerUrl)) {
      Alert.alert('No website saved', 'Edit this connection and add your electricity company\'s website to open it from here.');
      return;
    }
    Linking.openURL(c.providerUrl).catch(() => Alert.alert('Could not open the website', c.providerUrl ?? ''));
  };

  const list = connections.data ?? [];
  const canSave = code !== '' && isValidNumber(number) && (code !== OTHER || otherName.trim().length > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Electricity" showBack />
      {connections.isLoading ? (
        <LoadingState message="Loading…" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Card style={styles.intro}>
            <Ionicons name="flash-outline" size={22} color={colors.primary} />
            <Text style={styles.introText}>
              Save your electricity consumer number and NG Home reminds you every month to check and pay the bill. It does not fetch your bill or
              take payment: the button opens your electricity company&apos;s own website. Only people in your flat can see this.
            </Text>
          </Card>

          {list.length === 0 && (
            <EmptyState icon="flash-outline" title="No connection saved yet" description={`You will get a reminder on the ${ordinal(DEFAULT_DAY)} of every month.`} actionLabel="Add my connection" onAction={openAdd} />
          )}

          {list.map((c) => (
            <Card key={c.id} style={styles.card}>
              <View style={styles.head}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{c.nickname || c.providerName}</Text>
                  {c.nickname ? <Text style={styles.meta}>{c.providerName}</Text> : null}
                  <Text style={styles.meta}>Consumer no. {c.consumerNumber}</Text>
                </View>
                <TouchableOpacity onPress={() => openEdit(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Edit ${c.nickname || c.providerName}`}>
                  <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Remind me on the {ordinal(c.reminderDay)} of every month</Text>
                  <Text style={styles.meta}>{c.remindersOn && c.nextReminder ? `Next reminder: ${dateText(c.nextReminder)}` : 'Reminders are off'}</Text>
                </View>
                <Switch
                  value={c.remindersOn}
                  onValueChange={(on) => toggle.mutate({ id: c.id, on })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  accessibilityLabel={`Monthly reminder for ${c.nickname || c.providerName}`}
                />
              </View>

              <Button label="Pay on the company's website" onPress={() => pay(c)} icon={<Ionicons name="open-outline" size={16} color={colors.textInverse} />} fullWidth />
              <TouchableOpacity onPress={() => confirmRemove(c)} accessibilityRole="button" accessibilityLabel={`Remove ${c.nickname || c.providerName}`} style={styles.removeRow}>
                <Text style={styles.remove}>Remove</Text>
              </TouchableOpacity>
            </Card>
          ))}

          {list.length > 0 && list.length < MAX_CONNECTIONS && <Button label="Add another connection" onPress={openAdd} variant="outline" fullWidth />}
        </ScrollView>
      )}

      <InlineSheet visible={open !== null} onRequestClose={() => !save.isPending && close()}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{editing ? 'Edit connection' : 'Add your connection'}</Text>
          <TouchableOpacity onPress={close} hitSlop={10} disabled={save.isPending} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }} contentContainerStyle={{ gap: spacing.md }}>
          <Text style={styles.label}>Electricity company</Text>
          <View style={styles.options}>
            {[...(providers.data?.electricity ?? []), { code: OTHER, name: 'Other', region: '', url: '' }].map((p) => (
              <TouchableOpacity
                key={p.code}
                onPress={() => setCode(p.code)}
                style={[styles.option, code === p.code && styles.optionOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: code === p.code }}
                accessibilityLabel={p.name}
              >
                <Text style={[styles.optionText, code === p.code && styles.optionTextOn]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {code === OTHER && (
            <>
              <TextInput style={styles.input} value={otherName} onChangeText={setOtherName} placeholder="Name of your electricity company" placeholderTextColor={colors.textTertiary} maxLength={80} accessibilityLabel="Company name" />
              <TextInput style={styles.input} value={otherUrl} onChangeText={setOtherUrl} placeholder="Its website to pay on (https://…), optional" placeholderTextColor={colors.textTertiary} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={300} accessibilityLabel="Company website" />
            </>
          )}

          <Text style={styles.label}>Consumer number</Text>
          <TextInput style={styles.input} value={number} onChangeText={setNumber} placeholder="As printed on your bill" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" autoCorrect={false} maxLength={25} accessibilityLabel="Consumer number" />

          <TextInput style={styles.input} value={nickname} onChangeText={setNickname} placeholder="A name for it, optional (e.g. Flat meter)" placeholderTextColor={colors.textTertiary} maxLength={40} accessibilityLabel="Name" />

          <Text style={styles.label}>Remind me on the {ordinal(day)} of every month</Text>
          <View style={styles.stepper}>
            <TouchableOpacity onPress={() => setDay((d) => clampDay(d - 1))} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Earlier reminder day">
              <Ionicons name="remove" size={20} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.stepValue}>{ordinal(day)}</Text>
            <TouchableOpacity onPress={() => setDay((d) => clampDay(d + 1))} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Later reminder day">
              <Ionicons name="add" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </ScrollView>
        <Button label={editing ? 'Save changes' : 'Save and remind me'} onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} fullWidth style={{ marginTop: spacing.md }} />
      </InlineSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md, paddingBottom: spacing['4xl'] },
  intro: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  introText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { ...typography.labelLarge, color: colors.text },
  removeRow: { alignSelf: 'center', paddingVertical: spacing.xs },
  remove: { ...typography.labelMedium, color: colors.error },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  options: { gap: spacing.xs },
  option: { paddingVertical: spacing.md - 2, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionText: { ...typography.bodyMedium, color: colors.text },
  optionTextOn: { color: colors.primary, fontWeight: '600' },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md - 2, ...typography.bodyMedium, color: colors.text, backgroundColor: colors.surface },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  stepValue: { ...typography.headingSmall, color: colors.text, minWidth: 56, textAlign: 'center' },
});
