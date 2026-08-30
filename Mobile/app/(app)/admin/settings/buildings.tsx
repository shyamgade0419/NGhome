import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography } from '@/theme';
import { Building, Flat } from '@/types/society.types';

// ── Flat chip ──────────────────────────────────────────────────────
function FlatChip({ flat }: { flat: Flat }) {
  return (
    <View style={chipStyles.chip}>
      <Text style={chipStyles.label}>{flat.flatCode}</Text>
    </View>
  );
}
const chipStyles = StyleSheet.create({
  chip: {
    backgroundColor: colors.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    margin: 2,
  },
  label: { ...typography.labelSmall, color: colors.primary },
});

// ── Building card ──────────────────────────────────────────────────
function BuildingCard({ building, flats }: { building: Building; flats: Flat[] }) {
  const activeFlats = flats.filter((f) => f.isActive);
  const vacantFlats = flats.filter((f) => !f.isActive);

  return (
    <Card style={cardStyles.card}>
      {/* Header */}
      <View style={cardStyles.header}>
        <View style={cardStyles.headerIcon}>
          <Ionicons name="business" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.title}>{building.name}</Text>
          {building.code && <Text style={cardStyles.code}>{building.code}</Text>}
        </View>
        <View style={cardStyles.countBadge}>
          <Text style={cardStyles.countText}>{activeFlats.length}</Text>
          <Text style={cardStyles.countLabel}>flats</Text>
        </View>
      </View>

      {/* Meta row */}
      <View style={cardStyles.meta}>
        {building.totalFloors != null && (
          <View style={cardStyles.metaItem}>
            <Ionicons name="layers-outline" size={12} color={colors.textTertiary} />
            <Text style={cardStyles.metaText}>{building.totalFloors} floor{building.totalFloors !== 1 ? 's' : ''}</Text>
          </View>
        )}
        {vacantFlats.length > 0 && (
          <View style={cardStyles.metaItem}>
            <Ionicons name="alert-circle-outline" size={12} color={colors.warning} />
            <Text style={[cardStyles.metaText, { color: colors.warning }]}>{vacantFlats.length} inactive</Text>
          </View>
        )}
      </View>

      {/* Flat grid */}
      {activeFlats.length > 0 && (
        <View style={cardStyles.flatsSection}>
          <Text style={cardStyles.flatsLabel}>Active Flats</Text>
          <View style={cardStyles.flatsGrid}>
            {activeFlats.slice(0, 30).map((f) => (
              <FlatChip key={f.id} flat={f} />
            ))}
            {activeFlats.length > 30 && (
              <View style={chipStyles.chip}>
                <Text style={chipStyles.label}>+{activeFlats.length - 30} more</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </Card>
  );
}

const cardStyles = StyleSheet.create({
  card: { gap: spacing.md, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.headingSmall, color: colors.text },
  code: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  countBadge: { alignItems: 'center', minWidth: 44 },
  countText: { ...typography.headingMedium, color: colors.primary, fontWeight: '700' },
  countLabel: { ...typography.labelSmall, color: colors.textTertiary },
  meta: { flexDirection: 'row', gap: spacing.base },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...typography.bodySmall, color: colors.textTertiary },
  flatsSection: { gap: spacing.sm },
  flatsLabel: { ...typography.labelSmall, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  flatsGrid: { flexDirection: 'row', flexWrap: 'wrap', margin: -2 },
});

// ── Main screen ────────────────────────────────────────────────────
export default function BuildingsScreen() {
  const { data: buildingsData, isLoading: loadingBuildings, refetch, isRefetching } = useQuery({
    queryKey: ['admin-buildings'],
    queryFn: () => societiesApi.getBuildings({ limit: 50 }),
  });

  const { data: flatsData, isLoading: loadingFlats } = useQuery({
    queryKey: ['admin-flats-all'],
    queryFn: () => societiesApi.getFlats({ limit: 500 }),
  });

  const buildings: Building[] = buildingsData?.data ?? [];
  const allFlats: Flat[] = flatsData?.data ?? [];

  const isLoading = loadingBuildings || loadingFlats;

  if (isLoading) return <LoadingState fullscreen message="Loading buildings…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={`Buildings & Flats`}
        showBack
        subtitle={`${buildings.length} building${buildings.length !== 1 ? 's' : ''} · ${allFlats.filter(f => f.isActive).length} flats`}
      />

      <FlatList
        data={buildings}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        renderItem={({ item: building }) => (
          <BuildingCard
            building={building}
            flats={allFlats.filter((f) => f.buildingId === building.id)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="business-outline"
            title="No buildings yet"
            description="Buildings and flats are managed from the web dashboard."
          />
        }
        ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base },
});
