/**
 * Invite a guest. The server makes a one-time code and returns it in the
 * response that creates the invitation — it is never stored in readable form
 * or shown again, so this screen puts sharing it front and centre.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Share, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreatedInvitation, VisitorType, visitorsApi } from '@/api/endpoints/visitors.api';
import { societiesApi } from '@/api/endpoints/societies.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { fmtDayOf, fmtTime } from '@/utils/amenity-time';
import { VISITOR_TYPES, allowedDurations, phoneForApi, shareMessage, validUntilFrom } from '@/utils/visitors';
import { colors, radius, spacing, typography } from '@/theme';

export default function InviteScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: policy } = useQuery({ queryKey: ['visitor-policy'], queryFn: visitorsApi.policy, staleTime: 5 * 60_000 });
  const { data: society } = useQuery({ queryKey: ['society-my-mobile'], queryFn: societiesApi.getMySociety, staleTime: 5 * 60_000 });
  const durations = useMemo(() => allowedDurations(policy?.maxInviteDays ?? 7), [policy]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<VisitorType>('GUEST');
  const [hours, setHours] = useState(6);
  const [uses, setUses] = useState(1);
  const [note, setNote] = useState('');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);

  const maxUses = policy?.maxUsesPerInvite ?? 10;
  const chosenHours = durations.some((d) => d.hours === hours) ? hours : durations[durations.length - 1].hours;

  const invite = useMutation({
    mutationFn: () =>
      visitorsApi.invite({
        visitorName: name.trim(),
        visitorPhone: phoneForApi(phone),
        visitorType: type,
        note: note.trim() || undefined,
        validUntil: validUntilFrom(new Date(), chosenHours),
        maxUses: uses,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['my-invitations'] });
      setCreated(res);
    },
    onError: (e) => Alert.alert('Could not create the invitation', apiErrorMessage(e, 'Please try again.')),
  });

  const share = () => {
    if (!created) return;
    void Share.share({
      message: shareMessage({ code: created.code, visitorName: created.visitorName, societyName: society?.displayName ?? society?.name, validUntil: created.validUntil }),
    });
  };

  if (created) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invitation ready" showBack />
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.codeCard}>
            <Text style={styles.codeFor}>Entry code for {created.visitorName}</Text>
            <Text selectable style={styles.code} accessibilityLabel={`Code ${created.code.split('').join(' ')}`}>{created.code}</Text>
            <Text style={styles.codeValid}>
              Works until {fmtDayOf(created.validUntil)}, {fmtTime(created.validUntil)}
              {created.maxUses > 1 ? ` · up to ${created.maxUses} entries` : ' · one entry'}
            </Text>
          </View>
          <View style={styles.onceNote}>
            <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
            <Text style={styles.onceText}>
              This code is shown only now and cannot be looked up later. Share it with your guest, or cancel the invitation and make a new one.
            </Text>
          </View>
          <Button label="Share the code" icon={<Ionicons name="share-social-outline" size={18} color={colors.textInverse} />} onPress={share} fullWidth />
          <Button label="Done" variant="outline" onPress={() => router.replace('/(app)/visitors/invitations' as any)} fullWidth />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title="Invite a guest" subtitle="They get a code to show at the gate" showBack />
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Guest</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.textTertiary} maxLength={100} />
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Phone (optional)" placeholderTextColor={colors.textTertiary} keyboardType="phone-pad" maxLength={20} />

          <Text style={styles.label}>Type</Text>
          <View style={styles.chips}>
            {VISITOR_TYPES.map((t) => (
              <TouchableOpacity key={t.value} style={[styles.chip, type === t.value && styles.chipActive]} onPress={() => setType(t.value)}>
                <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Valid for</Text>
          <View style={styles.chips}>
            {durations.map((d) => (
              <TouchableOpacity key={d.hours} style={[styles.chip, chosenHours === d.hours && styles.chipActive]} onPress={() => setHours(d.hours)}>
                <Text style={[styles.chipText, chosenHours === d.hours && styles.chipTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Number of entries</Text>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setUses((n) => Math.max(1, n - 1))} accessibilityLabel="Fewer entries">
              <Ionicons name="remove" size={20} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.stepValue}>{uses}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setUses((n) => Math.min(maxUses, n + 1))} accessibilityLabel="More entries">
              <Ionicons name="add" size={20} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.stepHint}>{uses === 1 ? 'One visit' : `Up to ${uses} visits`}</Text>
          </View>

          <TextInput style={[styles.input, { minHeight: 64 }]} value={note} onChangeText={setNote} placeholder="Note for the guard (optional)" placeholderTextColor={colors.textTertiary} multiline maxLength={200} />

          <Button label="Create invitation" onPress={() => invite.mutate()} loading={invite.isPending} disabled={name.trim().length < 2} fullWidth />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.base, gap: spacing.md },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.sm },
  input: { ...typography.bodyMedium, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  stepValue: { ...typography.headingSmall, color: colors.text, minWidth: 28, textAlign: 'center' },
  stepHint: { ...typography.bodySmall, color: colors.textTertiary },
  codeCard: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  codeFor: { ...typography.labelMedium, color: colors.textSecondary },
  code: { ...typography.headingLarge, letterSpacing: 4, color: colors.primary, fontWeight: '800' },
  codeValid: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  onceNote: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningLight },
  onceText: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
