/**
 * Step 1 of resident join flow — enter the society's invite code.
 * The admin shares this code via WhatsApp. Resident types it here,
 * we fetch the society name + flat list, then proceed to resident-details.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, SocietyByCode } from '@/api/endpoints/auth.api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { colors, spacing, typography, radius } from '@/theme';

export default function JoinCodeScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [society, setSociety] = useState<SocietyByCode | null>(null);

  const normaliseCode = (raw: string) =>
    raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');

  const handleLookup = async () => {
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      Alert.alert('Invalid Code', 'Please enter the full join code shared by your admin.');
      return;
    }
    setLoading(true);
    try {
      const result = await authApi.getSocietyByCode(trimmed);
      setSociety(result);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Join code not found. Check with your society admin.';
      Alert.alert('Code Not Found', msg);
      setSociety(null);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!society) return;
    // Store join context for the next screen
    await AsyncStorage.setItem(
      'join_society',
      JSON.stringify({ joinCode: code.trim(), society }),
    );
    router.push('/(auth)/register/resident-details');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Join Your Society" showBack />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Illustration */}
          <View style={styles.iconBox}>
            <Ionicons name="key" size={40} color={colors.primary} />
          </View>

          <Text style={styles.heading}>Enter your invite code</Text>
          <Text style={styles.subheading}>
            Your society admin shares this code via WhatsApp or notice board.
          </Text>

          <View style={styles.inputRow}>
            <View style={styles.flex1}>
              <Input
                label="Join Code"
                placeholder="e.g. NGH-42F8"
                value={code}
                onChangeText={(t) => {
                  setCode(normaliseCode(t));
                  setSociety(null); // reset on change
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                leftIcon="key-outline"
                style={styles.codeInput}
              />
            </View>
            <Button
              label="Find"
              onPress={handleLookup}
              loading={loading}
              size="md"
              style={styles.findBtn}
            />
          </View>

          {/* Society preview card */}
          {society && (
            <View style={styles.societyCard}>
              <View style={styles.societyIcon}>
                <Ionicons name="business" size={24} color={colors.primary} />
              </View>
              <View style={styles.societyInfo}>
                <Text style={styles.societyName}>
                  {society.displayName || society.name}
                </Text>
                <Text style={styles.societyMeta}>
                  {society.flats.length} flats · Code verified ✓
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            </View>
          )}

          {society && (
            <Button
              label="Continue to Registration"
              onPress={handleContinue}
              fullWidth
              size="lg"
              style={styles.continueBtn}
            />
          )}

          <TouchableOpacity style={styles.helpRow} onPress={() => Alert.alert(
            'Where is my code?',
            'Your society admin generates a join code in the NG Home app under Settings → Society. Ask them to share it with you via WhatsApp.',
          )}>
            <Ionicons name="help-circle-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.helpText}>Where do I find this code?</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  flex1: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: spacing.base,
    paddingBottom: spacing['4xl'],
  },

  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },

  heading: {
    ...typography.headingLarge,
    color: colors.text,
    textAlign: 'center',
  },
  subheading: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing['2xl'],
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    marginBottom: spacing.base,
  },
  codeInput: {
    fontFamily: 'monospace',
    letterSpacing: 2,
    fontSize: 18,
  },
  findBtn: { marginBottom: 2 },

  societyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.successLight ?? colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
  },
  societyIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  societyInfo: { flex: 1 },
  societyName: { ...typography.bodyMedium, fontWeight: '700', color: colors.text },
  societyMeta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },

  continueBtn: { marginTop: spacing.sm },

  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
  },
  helpText: { ...typography.bodySmall, color: colors.textSecondary },
});
