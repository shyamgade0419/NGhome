import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography } from '@/theme';

// ── Section heading ────────────────────────────────────────────────
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={sectionStyles.title}>{title}</Text>
      {sub && <Text style={sectionStyles.sub}>{sub}</Text>}
    </View>
  );
}
const sectionStyles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  title: { ...typography.labelMedium, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  sub: { ...typography.bodySmall, color: colors.textTertiary, marginTop: 2 },
});

// ── Toggle row ─────────────────────────────────────────────────────
function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
  disabled,
}: {
  label: string;
  sublabel?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={toggleStyles.row}>
      <View style={toggleStyles.text}>
        <Text style={toggleStyles.label}>{label}</Text>
        {sublabel && <Text style={toggleStyles.sub}>{sublabel}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
      />
    </View>
  );
}
const toggleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.md,
  },
  text: { flex: 1 },
  label: { ...typography.bodyMedium, color: colors.text, fontWeight: '500' },
  sub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
});

// ── Main screen ────────────────────────────────────────────────────
type Config = {
  showAccountBalancesToResidents: boolean;
  showExpensesToResidents: boolean;
  publishStatementToResidents: boolean;
  publishMeetingMinutes: boolean;
  allowPaymentProofUpload: boolean;
};

const DEFAULTS: Config = {
  showAccountBalancesToResidents: false,
  showExpensesToResidents: false,
  publishStatementToResidents: false,
  publishMeetingMinutes: false,
  allowPaymentProofUpload: true,
};

export default function NotificationSettingsScreen() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Config>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['society-config-mobile'],
    queryFn: () => apiClient.get('/societies/my/config').then((r: any) => r.data?.data ?? r.data),
  });

  useEffect(() => {
    if (data) {
      setForm({
        showAccountBalancesToResidents: data.showAccountBalancesToResidents ?? false,
        showExpensesToResidents: data.showExpensesToResidents ?? false,
        publishStatementToResidents: data.publishStatementToResidents ?? false,
        publishMeetingMinutes: data.publishMeetingMinutes ?? false,
        allowPaymentProofUpload: data.allowPaymentProofUpload ?? true,
      });
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => apiClient.patch('/societies/my/config', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-config-mobile'] });
      setDirty(false);
      Alert.alert('Saved', 'Notification settings updated successfully.');
    },
    onError: () => Alert.alert('Error', 'Failed to save settings. Please try again.'),
  });

  const set = (key: keyof Config) => (val: boolean) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
  };

  if (isLoading) return <LoadingState fullscreen message="Loading settings…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notification Settings" showBack />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Resident Visibility */}
        <Card style={styles.section}>
          <SectionHead
            title="Resident Visibility"
            sub="What financial information residents can see in the app"
          />
          {/* There was a "Show corpus balance" switch above this one that was
              read by nothing — an admin turning it off believed corpus was
              hidden while residents could still see it. Corpus and every other
              fund are shown or hidden one at a time, on the fund itself, so
              that is the only place the choice is now offered. */}
          <ToggleRow
            label="Show total bank balance"
            sublabel="Residents can see the society's combined account balance. Each fund is shown or hidden separately, under Accounts & Funds."
            value={form.showAccountBalancesToResidents}
            onChange={set('showAccountBalancesToResidents')}
          />
          <ToggleRow
            label="Show expense records"
            sublabel="Residents can see society expense details"
            value={form.showExpensesToResidents}
            onChange={set('showExpensesToResidents')}
          />
          <ToggleRow
            label="Publish billing statements"
            sublabel="Residents can view monthly billing statements"
            value={form.publishStatementToResidents}
            onChange={set('publishStatementToResidents')}
          />
          <View style={{ borderBottomWidth: 0 }}>
            <ToggleRow
              label="Publish meeting minutes"
              sublabel="Residents can read AGM / committee meeting notes"
              value={form.publishMeetingMinutes}
              onChange={set('publishMeetingMinutes')}
            />
          </View>
        </Card>

        {/* Payment Settings */}
        <Card style={styles.section}>
          <SectionHead
            title="Payment Settings"
            sub="How residents submit and verify payments"
          />
          <View style={{ borderBottomWidth: 0 }}>
            <ToggleRow
              label="Allow proof upload"
              sublabel="Residents can attach bank screenshots to payments"
              value={form.allowPaymentProofUpload}
              onChange={set('allowPaymentProofUpload')}
            />
          </View>
          {/* Payment verification lives in Society Settings → UPI & Payments,
              next to the UPI ID it applies to. Editing it in two places let
              whichever screen saved last silently revert the other. */}
          <Text style={styles.crossRef}>
            Auto-approval of UPI payments is configured in Society Settings → UPI &amp; Payments.
          </Text>
        </Card>

        <Button
          label={mutation.isPending ? 'Saving…' : 'Save Settings'}
          onPress={() => mutation.mutate()}
          loading={mutation.isPending}
          disabled={!dirty}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.sm }}
        />

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md },
  section: { gap: 0 },
  crossRef: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    paddingTop: spacing.md,
    lineHeight: 17,
  },
});
