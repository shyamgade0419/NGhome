import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

export default function RegisterCompleteScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconRing}>
          <Ionicons name="checkmark-circle" size={80} color={colors.secondary} />
        </View>

        <Text style={styles.title}>Society Created!</Text>
        <Text style={styles.description}>
          Your society has been successfully registered on NG Home. You can now start managing your
          community.
        </Text>

        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>What's next?</Text>
          <View style={styles.tipList}>
            {[
              'Add buildings and floors',
              'Register flats and residents',
              'Set up billing rules',
              'Configure society settings',
            ].map((tip, i) => (
              <View key={i} style={styles.tipItem}>
                <View style={styles.tipBullet}>
                  <Text style={styles.tipBulletText}>{i + 1}</Text>
                </View>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        </View>

        <Button
          label="Go to Dashboard"
          onPress={() => router.replace('/(app)')}
          fullWidth
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.xl,
    paddingTop: spacing['4xl'],
    gap: spacing.lg,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.displaySmall,
    color: colors.text,
    textAlign: 'center',
  },
  description: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  tipCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  tipTitle: {
    ...typography.headingSmall,
    color: colors.text,
  },
  tipList: { gap: spacing.md },
  tipItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tipBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipBulletText: {
    ...typography.labelMedium,
    color: colors.primary,
    fontWeight: '700',
  },
  tipText: { ...typography.bodyMedium, color: colors.text, flex: 1 },
});
