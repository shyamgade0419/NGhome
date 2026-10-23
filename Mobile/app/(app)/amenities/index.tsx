/**
 * Amenities — the shared spaces a resident can book (clubhouse, hall, court,
 * gym). Tapping one opens its day-by-day slot picker. Committee members also
 * get a shortcut to manage the spaces and review booking requests.
 */

import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { amenitiesApi, Amenity } from '@/api/endpoints/amenities.api';
import { useIsRole } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Card } from '@/components/ui/Card';
import { fmtMinutes } from '@/utils/amenity-time';
import { inr } from '@/utils/format';
import { colors, spacing, typography } from '@/theme';

function AmenityRow({ amenity, onPress }: { amenity: Amenity; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.rowTop}>
        <View style={styles.icon}>
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{amenity.name}</Text>
          <Text style={styles.hours}>
            {fmtMinutes(amenity.opensAtMin)} – {fmtMinutes(amenity.closesAtMin)} · {amenity.slotMinutes} min slots
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </View>
      {amenity.description ? (
        <Text style={styles.description} numberOfLines={2}>{amenity.description}</Text>
      ) : null}
      <View style={styles.badges}>
        <StatusBadge
          size="sm"
          label={amenity.bookingMode === 'INSTANT' ? 'Instant booking' : 'Needs approval'}
          variant={amenity.bookingMode === 'INSTANT' ? 'success' : 'warning'}
        />
        <StatusBadge size="sm" label={amenity.fee ? `${inr(amenity.fee)} per booking` : 'Free'} variant="neutral" />
      </View>
    </Card>
  );
}

export default function AmenitiesScreen() {
  const router = useRouter();
  const isCommittee = useIsRole('SOCIETY_ADMIN', 'COMMITTEE_MEMBER');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['amenities'],
    queryFn: () => amenitiesApi.list(),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Amenities"
        subtitle="Book a shared space"
        showBack
        rightAction={
          <View style={styles.headerActions}>
            {isCommittee && (
              <TouchableOpacity onPress={() => router.push('/(app)/admin/amenities' as any)} hitSlop={8} accessibilityLabel="Manage amenities">
                <Ionicons name="settings-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => router.push('/(app)/amenities/mine' as any)} hitSlop={8} accessibilityLabel="My bookings">
              <Ionicons name="list-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>
        }
      />

      {isLoading ? (
        <LoadingState message="Loading amenities…" />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          renderItem={({ item }) => (
            <AmenityRow amenity={item} onPress={() => router.push(`/(app)/amenities/${item.id}` as any)} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="No amenities yet"
              description={
                isCommittee
                  ? 'Add your clubhouse, hall or court from the settings icon above so residents can book it.'
                  : 'Your society has not set up any bookable spaces yet.'
              }
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...typography.labelLarge, color: colors.text },
  hours: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  description: { ...typography.bodySmall, color: colors.textSecondary },
  badges: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
