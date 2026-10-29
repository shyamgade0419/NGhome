/**
 * The gate's vehicle lookup: whose is this vehicle? The guard types as much of the number as they
 * can see (usually the last digits) and gets the flat number and parking slot. A resident's name
 * or phone is never shown; the guard needs a destination, not a directory. No match means the
 * vehicle is not a resident's, so it is treated as a visitor's.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { vehiclesApi } from '@/api/endpoints/vehicles.api';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { MIN_LOOKUP, canLookup, formatPlate, kindLabel, tidyPlate, vehicleSubtitle } from '@/utils/vehicles';
import { colors, radius, spacing, typography } from '@/theme';

export function VehiclePanel() {
  const [text, setText] = useState('');
  const q = tidyPlate(text);
  const ready = canLookup(text);

  const result = useQuery({
    queryKey: ['gate-vehicle-lookup', q],
    queryFn: () => vehiclesApi.lookup(q),
    enabled: ready,
    staleTime: 15_000,
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchBox}>
        <Ionicons name="car-outline" size={20} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={text}
          onChangeText={(t) => setText(tidyPlate(t))}
          placeholder="Number plate, or its last digits"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={14}
          accessibilityLabel="Vehicle number"
        />
      </View>

      {!ready ? (
        <EmptyState icon="car-outline" title="Check a vehicle" description={`Type at least ${MIN_LOOKUP} letters or digits of the number to see which flat it belongs to.`} />
      ) : result.isLoading ? (
        <LoadingState message="Checking…" />
      ) : result.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Could not check" description="Check the connection and try again." actionLabel="Try again" onAction={() => result.refetch()} />
      ) : (
        <FlatList
          data={result.data ?? []}
          keyExtractor={(v) => v.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.top}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.plate}>{formatPlate(item.plate)}</Text>
                  <Text style={styles.meta}>{kindLabel(item.kind)} · {vehicleSubtitle(item)}</Text>
                </View>
                <View style={styles.flatBadge}>
                  <Text style={styles.flatBadgeText}>{item.flatCode}</Text>
                </View>
              </View>
              <Text style={styles.time}>{item.slotCodes.length ? `Parking: ${item.slotCodes.join(', ')}` : 'No parking slot set'}</Text>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState icon="alert-circle-outline" title="Not a resident's vehicle" description="No registered vehicle matches. Treat it as a visitor's: register the visitor, and the resident is asked." />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.base, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, ...typography.headingSmall, color: colors.text, paddingVertical: spacing.md, letterSpacing: 2 },
  list: { paddingHorizontal: spacing.base, paddingBottom: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  plate: { ...typography.headingSmall, color: colors.text, letterSpacing: 1 },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  flatBadge: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  flatBadgeText: { ...typography.labelLarge, color: colors.primary },
});
