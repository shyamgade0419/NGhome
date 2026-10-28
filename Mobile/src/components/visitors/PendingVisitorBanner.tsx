import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { visitorsApi } from '@/api/endpoints/visitors.api';
import { colors, radius, spacing, typography } from '@/theme';

/**
 * The most urgent thing on a resident's home screen: someone is at the gate
 * waiting for an answer. Draws nothing when nobody is, and nothing at all if
 * the request fails — it must never get in the way of the home screen.
 */
export function PendingVisitorBanner() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['my-visitors-pending'],
    queryFn: () => visitorsApi.myVisitors('PENDING_APPROVAL'),
    refetchInterval: 15_000,
    retry: false,
  });
  if (!data || data.length === 0) return null;

  const first = data[0];
  const more = data.length - 1;
  return (
    <TouchableOpacity style={styles.banner} onPress={() => router.push('/(app)/visitors' as any)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Visitor waiting at the gate. Review">
      <View style={styles.icon}>
        <Ionicons name="walk-outline" size={22} color={colors.warning} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{first.visitorName} is at the gate</Text>
        <Text style={styles.sub}>{more > 0 ? `and ${more} more waiting` : 'Waiting for your answer'}</Text>
      </View>
      <Text style={styles.cta}>Review</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.base, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warning },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.labelLarge, color: colors.text },
  sub: { ...typography.bodySmall, color: colors.textSecondary },
  cta: { ...typography.labelLarge, color: colors.primary },
});
