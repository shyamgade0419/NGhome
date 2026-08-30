/**
 * Step 2 of resident join flow — personal details + flat selection.
 * Reads join context (joinCode, society, flats) from AsyncStorage,
 * collects name / email / phone / flat / password, then calls
 * POST /auth/join-society. On success, saves tokens and enters the app.
 */
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, SocietyByCode } from '@/api/endpoints/auth.api';
import { tokenService } from '@/auth/token.service';
import { useAuthContext } from '@/auth/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { colors, spacing, typography, radius } from '@/theme';

const schema = z
  .object({
    firstName: z.string().min(2, 'First name required'),
    lastName: z.string().min(1, 'Last name required'),
    email: z.string().email('Valid email required'),
    phone: z
      .string()
      .regex(/^\+?\d{10,15}$/, 'Enter a valid mobile number (10–15 digits)'),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Must contain uppercase')
      .regex(/[0-9]/, 'Must contain a number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export default function ResidentDetailsScreen() {
  const router = useRouter();
  const { refreshUser } = useAuthContext();
  const [loading, setLoading] = useState(false);
  const [society, setSociety] = useState<SocietyByCode | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [selectedFlat, setSelectedFlat] = useState<{ id: string; flatCode: string } | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    AsyncStorage.getItem('join_society').then((raw) => {
      if (!raw) { router.replace('/(auth)/register/join-code'); return; }
      const { joinCode: code, society: s } = JSON.parse(raw);
      setJoinCode(code);
      setSociety(s);
    });
  }, []);

  const pickFlat = () => {
    if (!society?.flats?.length) {
      Alert.alert('No Flats', 'No flats found for this society. Contact your admin.');
      return;
    }
    Alert.alert(
      'Select Your Flat',
      'Choose the flat you reside in',
      [
        ...society.flats.map((f) => ({
          text: f.flatCode,
          onPress: () => setSelectedFlat({ id: f.id, flatCode: f.flatCode }),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  const onSubmit = async (form: FormData) => {
    if (!selectedFlat) {
      Alert.alert('Select Flat', 'Please select your flat number first.');
      return;
    }
    setLoading(true);
    try {
      const result = await authApi.joinSociety({
        joinCode,
        flatId: selectedFlat.id,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
      });

      await tokenService.setTokens(result.accessToken, result.refreshToken);
      await AsyncStorage.removeItem('join_society');
      await refreshUser();

      // If membership is PENDING_APPROVAL the app's resident layout will
      // detect it and show the pending screen automatically.
      router.replace('/(app)');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? 'Registration failed. Please try again.';
      Alert.alert('Registration Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title={society ? society.displayName || society.name : 'Join Society'}
        subtitle="Create your resident account"
        showBack
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Step indicator */}
          <View style={styles.stepRow}>
            {[0, 1].map((i) => (
              <View
                key={i}
                style={[styles.stepDot, i === 0 && styles.stepDone, i === 1 && styles.stepActive]}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>Your Details</Text>
          <Text style={styles.sectionSub}>
            These will be used for your resident account and WhatsApp billing reminders.
          </Text>

          <View style={styles.form}>
            {/* Name row */}
            <View style={styles.nameRow}>
              <View style={styles.flex1}>
                <Controller control={control} name="firstName" render={({ field: { onChange, onBlur, value } }) => (
                  <Input label="First Name" placeholder="Ravi" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.firstName?.message} required />
                )} />
              </View>
              <View style={styles.flex1}>
                <Controller control={control} name="lastName" render={({ field: { onChange, onBlur, value } }) => (
                  <Input label="Last Name" placeholder="Kumar" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.lastName?.message} required />
                )} />
              </View>
            </View>

            <Controller control={control} name="email" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Email" placeholder="ravi@example.com" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.email?.message} keyboardType="email-address" autoCapitalize="none" leftIcon="mail-outline" required />
            )} />

            {/* Phone — used for WhatsApp billing reminders */}
            <Controller control={control} name="phone" render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="WhatsApp / Mobile Number"
                placeholder="+91 9876543210"
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.phone?.message}
                keyboardType="phone-pad"
                leftIcon="logo-whatsapp"
                hint="Admin will send maintenance reminders to this number"
                required
              />
            )} />

            {/* Flat picker */}
            <View>
              <Text style={styles.flatLabel}>Your Flat <Text style={styles.required}>*</Text></Text>
              <TouchableOpacity style={[styles.flatPicker, !selectedFlat && styles.flatPickerEmpty]} onPress={pickFlat} activeOpacity={0.7}>
                <Ionicons name="home-outline" size={18} color={selectedFlat ? colors.text : colors.textTertiary} />
                <Text style={[styles.flatPickerText, !selectedFlat && styles.flatPickerPlaceholder]}>
                  {selectedFlat ? selectedFlat.flatCode : 'Select your flat'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Controller control={control} name="password" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Password" placeholder="At least 8 characters" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.password?.message} secureTextEntry leftIcon="lock-closed-outline" hint="Min 8 chars, 1 uppercase, 1 number" required />
            )} />

            <Controller control={control} name="confirmPassword" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Confirm Password" placeholder="Re-enter password" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.confirmPassword?.message} secureTextEntry leftIcon="lock-closed-outline" required />
            )} />

            {/* Phone note */}
            <View style={styles.whatsappNote}>
              <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
              <Text style={styles.whatsappNoteText}>
                Your mobile number will be used by the admin to send you maintenance bill reminders directly via WhatsApp.
              </Text>
            </View>

            <Button label="Create Resident Account" onPress={handleSubmit(onSubmit)} loading={loading} fullWidth size="lg" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  flex1: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.base, paddingBottom: spacing['4xl'] },

  stepRow: { flexDirection: 'row', gap: 6, marginBottom: spacing.xl },
  stepDot: { height: 4, flex: 1, borderRadius: 2, backgroundColor: colors.border },
  stepDone: { backgroundColor: colors.secondary },
  stepActive: { backgroundColor: colors.primary },

  sectionTitle: { ...typography.headingMedium, color: colors.text },
  sectionSub: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },

  form: { gap: spacing.base },
  nameRow: { flexDirection: 'row', gap: spacing.md },

  flatLabel: { ...typography.labelMedium, color: colors.text, marginBottom: spacing.xs },
  required: { color: colors.error },
  flatPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  flatPickerEmpty: { borderColor: colors.borderLight },
  flatPickerText: { flex: 1, ...typography.bodyMedium, color: colors.text },
  flatPickerPlaceholder: { color: colors.textTertiary },

  whatsappNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#F0FDF4',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  whatsappNoteText: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
