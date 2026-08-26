import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/api/endpoints/auth.api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { colors, spacing, typography } from '@/theme';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
});

type FormData = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async ({ email }: FormData) => {
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Forgot Password" showBack />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {sent ? (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>Check your email</Text>
              <Text style={styles.successText}>
                We've sent a password reset link to your email address. Please check your inbox.
              </Text>
              <Button label="Back to Login" onPress={() => router.replace('/(auth)/login')} fullWidth />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.description}>
                Enter the email address associated with your account and we'll send you a link to reset your password.
              </Text>
              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Email Address"
                    placeholder="your@email.com"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.email?.message}
                    leftIcon="mail-outline"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    required
                  />
                )}
              />
              <Button label="Send Reset Link" onPress={handleSubmit(onSubmit)} loading={loading} fullWidth size="lg" />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.base },
  description: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  form: { gap: spacing.base },
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.xl,
    gap: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xl,
  },
  successTitle: {
    ...typography.headingMedium,
    color: colors.text,
  },
  successText: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
