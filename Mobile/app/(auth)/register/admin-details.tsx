import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '@/api/endpoints/auth.api';
import { tokenService } from '@/auth/token.service';
import { useAuthContext } from '@/auth/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { colors, spacing, typography } from '@/theme';

const schema = z
  .object({
    firstName: z.string().min(2, 'First name required'),
    lastName: z.string().min(1, 'Last name required'),
    email: z.string().email('Valid email required'),
    phone: z.string().regex(/^\+?\d{7,15}$/, 'Valid phone required'),
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

export default function AdminDetailsScreen() {
  const router = useRouter();
  const { refreshUser } = useAuthContext();
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (adminData: FormData) => {
    setLoading(true);
    try {
      const societyRaw = await AsyncStorage.getItem('reg_society');
      if (!societyRaw) throw new Error('Society data missing');
      const society = JSON.parse(societyRaw);

      const result = await authApi.registerSociety({
        society,
        admin: {
          firstName: adminData.firstName,
          lastName: adminData.lastName,
          email: adminData.email,
          phone: adminData.phone,
          password: adminData.password,
        },
      });

      await tokenService.setTokens(result.accessToken, result.refreshToken);
      await AsyncStorage.removeItem('reg_society');
      await refreshUser();

      router.replace('/(auth)/register/complete');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Registration failed. Please try again.';
      Alert.alert('Registration Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Register Society" subtitle="Step 2 of 2" showBack />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.stepRow}>
            {[0, 1].map((i) => (
              <View
                key={i}
                style={[styles.stepDot, i === 0 && styles.stepDone, i === 1 && styles.stepActive]}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>Administrator Account</Text>
          <Text style={styles.sectionSubtitle}>
            Create the primary admin account for your society
          </Text>

          <View style={styles.form}>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Controller
                  control={control}
                  name="firstName"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      label="First Name"
                      placeholder="John"
                      value={value ?? ''}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.firstName?.message}
                      required
                    />
                  )}
                />
              </View>
              <View style={styles.flex1}>
                <Controller
                  control={control}
                  name="lastName"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      label="Last Name"
                      placeholder="Doe"
                      value={value ?? ''}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.lastName?.message}
                      required
                    />
                  )}
                />
              </View>
            </View>

            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Email"
                  placeholder="admin@example.com"
                  value={value ?? ''}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  leftIcon="mail-outline"
                  required
                />
              )}
            />

            <Controller
              control={control}
              name="phone"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Mobile Number"
                  placeholder="+91 9876543210"
                  value={value ?? ''}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.phone?.message}
                  keyboardType="phone-pad"
                  leftIcon="call-outline"
                  required
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Password"
                  placeholder="At least 8 characters"
                  value={value ?? ''}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                  secureTextEntry
                  leftIcon="lock-closed-outline"
                  hint="Min 8 chars, 1 uppercase, 1 number"
                  required
                />
              )}
            />

            <Controller
              control={control}
              name="confirmPassword"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Confirm Password"
                  placeholder="Re-enter password"
                  value={value ?? ''}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.confirmPassword?.message}
                  secureTextEntry
                  leftIcon="lock-closed-outline"
                  required
                />
              )}
            />

            <Button
              label="Create Society"
              onPress={handleSubmit(onSubmit)}
              loading={loading}
              fullWidth
              size="lg"
            />
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
  sectionSubtitle: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.base },
  row: { flexDirection: 'row', gap: spacing.md },
});
