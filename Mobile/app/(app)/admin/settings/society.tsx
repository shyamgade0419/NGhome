import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

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

  const { data, isLoading } = useQuery({
    queryKey: ['society-my-mobile'],
    queryFn: societiesApi.getMySociety,
  });

  useEffect(() => {
    if (data) {
      setForm({
        name: (data as any).name ?? '',
        displayName: (data as any).displayName ?? '',
        address: (data as any).address ?? '',
        city: (data as any).city ?? '',
        state: (data as any).state ?? '',
        pincode: (data as any).pincode ?? '',
        email: (data as any).email ?? '',
        phone: (data as any).phone ?? '',
      });
    }
  }, [data]);

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
          <Input label="Street Address" value={form.address} onChangeText={set('address')} placeholder="123, Park Street" />
          <View style={styles.row3}>
            <View style={styles.flex2}>
              <Input label="City" value={form.city} onChangeText={set('city')} placeholder="Hyderabad" />
            </View>
            <View style={styles.flex1}>
              <Input label="State" value={form.state} onChangeText={set('state')} placeholder="TS" />
            </View>
            <View style={styles.flex1}>
              <Input label="Pincode" value={form.pincode} onChangeText={set('pincode')} keyboardType="numeric" placeholder="500001" />
            </View>
          </View>

          <Section title="Contact" />
          <Input label="Email" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" placeholder="society@example.com" />
          <Input label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+91 98765 43210" />

          <Button
            label={mutation.isPending ? 'Saving…' : 'Save Details'}
            onPress={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!dirty || !form.name.trim()}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.xl }}
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
});
