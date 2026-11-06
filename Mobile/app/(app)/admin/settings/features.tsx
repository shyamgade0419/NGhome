import React from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { IconChip } from '@/components/ui/IconChip';
import { useIsSocietyAdmin } from '@/hooks/useAuth';
import { useFeatures } from '@/hooks/useFeatures';
import { FEATURES, FeatureKey, Features } from '@/features/catalog';
import { colors, radius, spacing, typography } from '@/theme';

/**
 * Settings → Features. Switch off the parts of the app this society does not use (no parking, no gate, no clubhouse),
 * and they disappear from every resident's and admin's app and from the website. Nothing is deleted: switch one back on
 * and it returns with its data.
 */
export default function FeaturesScreen() {
  const qc = useQueryClient();
  const isAdmin = useIsSocietyAdmin();
  const { features } = useFeatures();

  const save = useMutation({
    mutationFn: (patch: Partial<Features>) => societiesApi.setFeatures(patch),
    // Shown at once; put back if the server refuses.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['society-features'] });
      const before = qc.getQueryData<Features>(['society-features']);
      qc.setQueryData<Features>(['society-features'], { ...features, ...patch });
      return { before };
    },
    onError: (e: any, _patch, ctx) => {
      qc.setQueryData(['society-features'], ctx?.before);
      Alert.alert('Not saved', e?.response?.data?.message ?? 'Could not change that. Try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['society-features'] }),
  });

  const switchedOff = FEATURES.filter((f) => !features[f.key]).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Features" showBack area={{ tone: 'teal', icon: 'toggle-outline' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          Switch off what your society does not use, such as parking or a clubhouse. It disappears from everyone&apos;s app and
          from the website. Nothing is deleted: switch it back on and it returns with its data.
        </Text>
        <Text style={styles.count} accessibilityLabel="How many features are off">
          {switchedOff === 0 ? 'Everything is switched on.' : `${switchedOff} switched off.`}
        </Text>

        <View style={styles.card}>
          {FEATURES.map((f, i) => (
            <View key={f.key} style={[styles.row, i > 0 && styles.rowBorder]}>
              <IconChip tone={f.tone} icon={f.icon} />
              <View style={styles.rowText}>
                <Text style={styles.label}>{f.label}</Text>
                <Text style={styles.description}>{f.description}</Text>
              </View>
              <Switch
                value={features[f.key]}
                onValueChange={(on) => save.mutate({ [f.key]: on } as Partial<Record<FeatureKey, boolean>>)}
                disabled={!isAdmin}
                trackColor={{ false: colors.border, true: colors.primary }}
                accessibilityLabel={f.label}
              />
            </View>
          ))}
        </View>
        {!isAdmin && <Text style={styles.note}>Only the society admin can change these.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.base, gap: spacing.md, paddingBottom: spacing['3xl'] },
  intro: { ...typography.bodyMedium, color: colors.textSecondary },
  count: { ...typography.labelLarge, color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { flex: 1 },
  label: { ...typography.headingSmall, color: colors.text },
  description: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  note: { ...typography.bodySmall, color: colors.textTertiary, textAlign: 'center' },
});
