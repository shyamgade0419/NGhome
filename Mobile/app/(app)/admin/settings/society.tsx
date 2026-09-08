import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  Share,
  Switch,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { Society } from '@/types/society.types';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

// ─── Section heading ─────────────────────────────────────────────────────────

function Section({ title }: { title: string }) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={sectionStyles.text}>{title}</Text>
      <View style={sectionStyles.line} />
    </View>
  );
}
const sectionStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.md },
  text: { ...typography.labelSmall, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 1 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
});

// ─── Join Code card ───────────────────────────────────────────────────────────

function JoinCodeCard() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['society-join-code'],
    queryFn: societiesApi.getJoinCode,
  });

  const regenMutation = useMutation({
    mutationFn: societiesApi.regenerateJoinCode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-join-code'] });
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to regenerate code.'),
  });

  const code = data?.joinCode ?? '—';
  const generatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : null;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const message =
      `🏢 Join our society on NG Home!\n\n` +
      `Use this invite code when you tap *"Join Society"* on the NG Home login screen:\n\n` +
      `*${code}*\n\n` +
      `📱 Download NG Home and select "Have an invite code? Join your society"`;
    try {
      await Share.share({ message });
    } catch (_) {
      // User cancelled share sheet — no action needed
    }
  };

  const handleRegenerate = () => {
    Alert.alert(
      'Regenerate Code',
      'The current code will stop working immediately. Any resident who hasn\'t joined yet will need the new code.\n\nContinue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: () => regenMutation.mutate(),
        },
      ],
    );
  };

  return (
    <View style={cardStyles.container}>
      {/* Card header */}
      <View style={cardStyles.header}>
        <View style={cardStyles.headerIcon}>
          <Ionicons name="key" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.headerTitle}>Resident Invite Code</Text>
          <Text style={cardStyles.headerSub}>
            Share with residents — they tap &ldquo;Join Society&rdquo; on login
          </Text>
        </View>
      </View>

      {/* Code display */}
      <View style={cardStyles.codeBox}>
        {isLoading ? (
          <Text style={cardStyles.codePlaceholder}>Loading…</Text>
        ) : (
          <Text style={cardStyles.code} selectable>
            {code}
          </Text>
        )}
        {generatedAt && (
          <Text style={cardStyles.codeMeta}>Generated {generatedAt}</Text>
        )}
      </View>

      {/* Action buttons */}
      <View style={cardStyles.actions}>
        {/* Copy */}
        <TouchableOpacity
          style={[cardStyles.actionBtn, cardStyles.actionCopy]}
          onPress={handleCopy}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={16}
            color={copied ? colors.success : colors.primary}
          />
          <Text style={[cardStyles.actionLabel, copied && cardStyles.actionLabelSuccess]}>
            {copied ? 'Copied!' : 'Copy'}
          </Text>
        </TouchableOpacity>

        {/* WhatsApp share */}
        <TouchableOpacity
          style={[cardStyles.actionBtn, cardStyles.actionShare]}
          onPress={handleShare}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
          <Text style={[cardStyles.actionLabel, { color: '#25D366' }]}>
            Share via WhatsApp
          </Text>
        </TouchableOpacity>
      </View>

      {/* Regenerate */}
      <TouchableOpacity
        style={cardStyles.regenRow}
        onPress={handleRegenerate}
        disabled={regenMutation.isPending || isLoading}
        activeOpacity={0.6}
      >
        <Ionicons
          name="refresh-outline"
          size={13}
          color={regenMutation.isPending ? colors.textTertiary : colors.textSecondary}
        />
        <Text style={[cardStyles.regenText, regenMutation.isPending && { color: colors.textTertiary }]}>
          {regenMutation.isPending ? 'Generating new code…' : 'Regenerate code'}
        </Text>
      </TouchableOpacity>

      {/* How it works note */}
      <View style={cardStyles.note}>
        <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
        <Text style={cardStyles.noteText}>
          Residents download the NG Home app, tap <Text style={{ fontWeight: '600' }}>&ldquo;Have an invite code?&rdquo;</Text> on
          the login screen, enter this code, choose their flat and create their account.
        </Text>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1.5,
    borderColor: colors.primary + '33', // primary @ 20% opacity
    borderRadius: radius.xl,
    padding: spacing.base,
    gap: spacing.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: {
    ...typography.bodyMedium,
    fontWeight: '700',
    color: colors.text,
  },
  headerSub: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },

  codeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
    gap: 6,
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 4,
  },
  codePlaceholder: {
    fontSize: 28,
    color: colors.textTertiary,
    letterSpacing: 4,
  },
  codeMeta: {
    ...typography.labelSmall,
    color: colors.textTertiary,
    letterSpacing: 0.5,
  },

  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionCopy: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  actionShare: {
    backgroundColor: colors.secondaryLight,
    borderColor: colors.secondaryLight,
  },
  actionLabel: {
    ...typography.labelMedium,
    color: colors.primary,
  },
  actionLabelSuccess: {
    color: colors.success,
  },

  regenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  regenText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  noteText: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.textTertiary,
    lineHeight: 18,
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SocietySettingsScreen() {
  const qc = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    email: '',
    phone: '',
  });
  const [upiDirty, setUpiDirty] = useState(false);
  const [upiForm, setUpiForm] = useState({
    upiId: '',
    paymentVerificationRequired: true,
  });

  const { data, isLoading } = useQuery<Society>({
    queryKey: ['society-my-mobile'],
    queryFn: societiesApi.getMySociety,
  });

  const { data: configData } = useQuery({
    queryKey: ['society-config-mobile'],
    queryFn: societiesApi.getSocietyConfig,
  });

  useEffect(() => {
    if (data) {
      setForm({
        name: data.name ?? '',
        displayName: data.displayName ?? '',
        address: data.address ?? '',
        city: data.city ?? '',
        state: data.state ?? '',
        pincode: data.pincode ?? '',
        email: data.email ?? '',
        phone: data.phone ?? '',
      });
    }
  }, [data]);

  useEffect(() => {
    if (configData) {
      setUpiForm({
        upiId: (configData as any)?.additionalConfig?.upiId ?? '',
        paymentVerificationRequired: (configData as any)?.paymentVerificationRequired !== false,
      });
    }
  }, [configData]);

  const mutation = useMutation({
    mutationFn: () => apiClient.patch('/societies/my', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-my-mobile'] });
      setDirty(false);
      Alert.alert('Saved', 'Society details updated successfully.');
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save. Try again.'),
  });

  const upiMutation = useMutation({
    // NOTE: the API DTO exposes `upiId` as a TOP-LEVEL field and stores it inside
    // additionalConfig server-side. Sending `additionalConfig` directly is rejected
    // with 400 because the global ValidationPipe runs forbidNonWhitelisted: true.
    mutationFn: () => apiClient.patch('/societies/my/config', {
      paymentVerificationRequired: upiForm.paymentVerificationRequired,
      upiId: upiForm.upiId.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-config-mobile'] });
      setUpiDirty(false);
      Alert.alert('Saved', 'Payment settings updated.');
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save payment settings.'),
  });

  const set = (key: string) => (val: string) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
  };

  if (isLoading) return <LoadingState fullscreen message="Loading society details…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Society Settings" showBack />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Resident Invite Code ── */}
          <Section title="Resident Invite Code" />
          <JoinCodeCard />

          {/* ── Society Details ── */}
          <Section title="Society Info" />
          <Input
            label="Society Name *"
            value={form.name}
            onChangeText={set('name')}
            placeholder="My Apartment"
          />
          <Input
            label="Display Name"
            value={form.displayName}
            onChangeText={set('displayName')}
            placeholder="Short name for invoices"
          />

          <Section title="Address" />
          <Input
            label="Street Address"
            value={form.address}
            onChangeText={set('address')}
            placeholder="123, Park Street"
          />
          <View style={styles.row3}>
            <View style={styles.flex2}>
              <Input label="City" value={form.city} onChangeText={set('city')} placeholder="Hyderabad" />
            </View>
            <View style={styles.flex1}>
              <Input label="State" value={form.state} onChangeText={set('state')} placeholder="TS" />
            </View>
            <View style={styles.flex1}>
              <Input
                label="Pincode"
                value={form.pincode}
                onChangeText={set('pincode')}
                keyboardType="numeric"
                placeholder="500001"
              />
            </View>
          </View>

          <Section title="Contact" />
          <Input
            label="Email"
            value={form.email}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="society@example.com"
          />
          <Input
            label="Phone"
            value={form.phone}
            onChangeText={set('phone')}
            keyboardType="phone-pad"
            placeholder="+91 98765 43210"
          />

          <Button
            label={mutation.isPending ? 'Saving…' : 'Save Details'}
            onPress={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!dirty || !form.name.trim()}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.xl }}
          />

          {/* ── UPI / Payment Settings ── */}
          <Section title="UPI & Payments" />
          <Input
            label="Society UPI ID"
            value={upiForm.upiId}
            onChangeText={(v) => { setUpiForm((f) => ({ ...f, upiId: v })); setUpiDirty(true); }}
            placeholder="society@upi or 9876543210@okaxis"
            leftIcon="qr-code-outline"
            autoCapitalize="none"
            hint="Residents will see this to pay via PhonePe, GPay, BHIM"
          />

          {/* Payment verification toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>Auto-approve UPI payments</Text>
              <Text style={styles.toggleSub}>
                When ON, payments submitted with a UTR are approved instantly without admin review.
              </Text>
            </View>
            <Switch
              value={!upiForm.paymentVerificationRequired}
              onValueChange={(v) => { setUpiForm((f) => ({ ...f, paymentVerificationRequired: !v })); setUpiDirty(true); }}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          <Button
            label={upiMutation.isPending ? 'Saving…' : 'Save Payment Settings'}
            onPress={() => upiMutation.mutate()}
            loading={upiMutation.isPending}
            disabled={!upiDirty}
            fullWidth
            size="lg"
          />

          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.sm },
  row3: { flexDirection: 'row', gap: spacing.md },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },
  toggleText: { flex: 1 },
  toggleLabel: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  toggleSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
});
