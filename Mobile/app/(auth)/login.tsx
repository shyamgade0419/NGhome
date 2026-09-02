import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '@/auth/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { NGLogo } from '@/components/ui/NGLogo';
import { colors, spacing, typography, radius } from '@/theme';

/* ─── Brand colours matching the logo design ─────────────────── */
const BRAND_NAVY   = '#0D2147';
const BRAND_GREEN  = '#3D8C3C';

const schema = z.object({
  identifier: z
    .string()
    .min(1, 'Email or phone is required')
    .max(200, 'Too long'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type FormData = z.infer<typeof schema>;

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthContext();
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = async ({ identifier, password }: FormData) => {
    setLoading(true);
    try {
      const needsSelection = await login(identifier.trim(), password);
      if (needsSelection) {
        router.replace('/(society-select)');
      } else {
        router.replace('/(app)');
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed. Please check your credentials.';
      if (message.toLowerCase().includes('password')) {
        setError('password', { message });
      } else {
        Alert.alert('Login Failed', message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={BRAND_NAVY} />
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Hero / Brand area ───────────────────────────── */}
            <View style={styles.hero}>
              {/* Shield logo — centered */}
              <View style={styles.logoWrap}>
                <NGLogo size={130} />
              </View>

              {/* Name + tagline */}
              <Text style={styles.brandName}>NG HOME</Text>
              <View style={styles.taglineRow}>
                <View style={styles.taglineLine} />
                <Text style={styles.tagline}>Powered by NovaGade</Text>
                <View style={styles.taglineLine} />
              </View>
            </View>

            {/* ── Login card ──────────────────────────────────── */}
            <View style={styles.card}>
              <Text style={styles.heading}>Welcome back</Text>
              <Text style={styles.subheading}>
                Sign in to your society account
              </Text>

              <View style={styles.form}>
                <Controller
                  control={control}
                  name="identifier"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      label="Email or Mobile Number"
                      placeholder="your@email.com or 9876543210"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.identifier?.message}
                      leftIcon="person-outline"
                      autoCapitalize="none"
                      // "default" (not "email-address") since the backend accepts
                      // phone numbers here too — an email-optimized keyboard
                      // hides the number row, which is awkward for a 10-digit
                      // phone. autoComplete lets iOS/Android suggest either.
                      keyboardType="default"
                      autoComplete="username"
                      textContentType="username"
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
                      placeholder="Enter your password"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.password?.message}
                      leftIcon="lock-closed-outline"
                      secureTextEntry
                      required
                    />
                  )}
                />

                <TouchableOpacity
                  onPress={() => router.push('/(auth)/forgot-password')}
                  style={styles.forgotRow}
                >
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </TouchableOpacity>

                <Button
                  label="Sign In"
                  onPress={handleSubmit(onSubmit)}
                  loading={loading}
                  fullWidth
                  size="lg"
                />
              </View>
            </View>

            {/* ── Footer links ────────────────────────────────── */}
            <View style={styles.footer}>
              {/* Register new society */}
              <View style={styles.footerRow}>
                <Text style={styles.footerText}>New society? </Text>
                <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                  <Text style={styles.footerLink}>Register here</Text>
                </TouchableOpacity>
              </View>

              {/* Join via invite code */}
              <TouchableOpacity
                style={styles.joinRow}
                onPress={() => router.push('/(auth)/register/join-code')}
                activeOpacity={0.7}
              >
                <Ionicons name="key-outline" size={15} color={BRAND_NAVY} />
                <Text style={styles.joinText}>Have an invite code? </Text>
                <Text style={styles.joinLink}>Join your society</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BRAND_NAVY,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    backgroundColor: BRAND_NAVY,
  },

  /* ── Hero ──────────────────────────────────────────────────── */
  hero: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 36,
    backgroundColor: BRAND_NAVY,
  },
  logoWrap: {
    marginBottom: 20,
    /* Subtle glow ring behind the shield */
    shadowColor: '#3D8C3C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 6,
    fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif-condensed',
  },
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  taglineLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    maxWidth: 48,
  },
  tagline: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 1.5,
  },

  /* ── Card ──────────────────────────────────────────────────── */
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 28,
    flex: 1,
    minHeight: 420,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: BRAND_NAVY,
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 24,
  },

  form: { gap: 14 },
  forgotRow: { alignItems: 'flex-end', marginTop: -4 },
  forgotText: {
    fontSize: 13,
    fontWeight: '600',
    color: BRAND_NAVY,
  },

  /* ── Footer ────────────────────────────────────────────────── */
  footer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 10,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#64748B',
  },
  footerLink: {
    fontSize: 14,
    color: BRAND_NAVY,
    fontWeight: '600',
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(13,33,71,0.15)',
    backgroundColor: '#F8FAFC',
  },
  joinText: {
    fontSize: 13,
    color: '#64748B',
  },
  joinLink: {
    fontSize: 13,
    color: BRAND_NAVY,
    fontWeight: '600',
  },
});
