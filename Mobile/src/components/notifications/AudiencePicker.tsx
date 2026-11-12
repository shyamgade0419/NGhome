import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { colors, spacing, typography, radius } from '@/theme';
import { tint, tones } from '@/theme/tones';
import {
  AUDIENCE_OPTIONS,
  AudienceChoice,
  allSelected,
  toggleAll,
  toggleId,
  withKind,
} from '@/notifications/audienceChoice';

/**
 * 'Send to': everyone, some buildings, some flats, the committee or the staff. Buildings and flats are listed from the
 * society's own, so an admin picks rather than types. A flat is chosen within a building, several at a time.
 */
export function AudiencePicker({ value, onChange }: { value: AudienceChoice; onChange: (next: AudienceChoice) => void }) {
  const needsList = value.kind === 'BUILDING' || value.kind === 'SPECIFIC_FLATS';
  const buildings = useQuery({
    queryKey: ['audience-buildings'],
    queryFn: () => societiesApi.getBuildings(),
    enabled: needsList,
    staleTime: 5 * 60_000,
  });
  const [openBuilding, setOpenBuilding] = useState<string | null>(null);
  const buildingList = (buildings.data?.data ?? []).filter((b: { isActive?: boolean }) => b.isActive !== false);
  const activeBuilding = openBuilding ?? buildingList[0]?.id ?? null;

  const flats = useQuery({
    queryKey: ['audience-flats', activeBuilding],
    queryFn: () => societiesApi.getFlats({ buildingId: activeBuilding!, page: 1, limit: 200 }),
    enabled: value.kind === 'SPECIFIC_FLATS' && !!activeBuilding,
    staleTime: 5 * 60_000,
  });
  const flatList = flats.data?.data ?? [];

  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.kinds} contentContainerStyle={s.kindsContent}>
        {AUDIENCE_OPTIONS.map((o) => {
          const on = o.kind === value.kind;
          return (
            <TouchableOpacity
              key={o.kind}
              style={[s.kind, on && s.kindOn]}
              onPress={() => onChange(withKind(value, o.kind))}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Send to ${o.label}`}
            >
              <Text style={[s.kindText, on && s.kindTextOn]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {value.kind === 'BUILDING' && (
        <View style={s.box}>
          {buildings.isLoading ? (
            <Text style={s.hint}>Loading buildings…</Text>
          ) : buildingList.length === 0 ? (
            <Text style={s.hint}>This society has no buildings set up yet.</Text>
          ) : (
            buildingList.map((b: { id: string; name: string }) => {
              const on = value.buildingIds.includes(b.id);
              return (
                <TouchableOpacity
                  key={b.id}
                  style={s.row}
                  onPress={() => onChange({ ...value, buildingIds: toggleId(value.buildingIds, b.id) })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={b.name}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? tones.teal : colors.textTertiary} />
                  <Text style={s.rowText}>{b.name}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}

      {value.kind === 'SPECIFIC_FLATS' && (
        <View style={s.box}>
          {buildings.isLoading ? (
            <Text style={s.hint}>Loading…</Text>
          ) : buildingList.length === 0 ? (
            <Text style={s.hint}>This society has no buildings or flats set up yet.</Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.kinds} contentContainerStyle={s.kindsContent}>
                {buildingList.map((b: { id: string; name: string }) => {
                  const on = b.id === activeBuilding;
                  return (
                    <TouchableOpacity key={b.id} style={[s.kind, on && s.kindOn]} onPress={() => setOpenBuilding(b.id)} accessibilityRole="button" accessibilityLabel={`Building ${b.name}`}>
                      <Text style={[s.kindText, on && s.kindTextOn]}>{b.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {flats.isLoading ? (
                <Text style={s.hint}>Loading flats…</Text>
              ) : flatList.length === 0 ? (
                <Text style={s.hint}>No flats in this building.</Text>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => onChange({ ...value, flatIds: toggleAll(value.flatIds, flatList.map((f: { id: string }) => f.id)) })}
                    accessibilityRole="button"
                    accessibilityLabel="Select all flats in this building"
                  >
                    <Text style={s.link}>
                      {allSelected(value.flatIds, flatList.map((f: { id: string }) => f.id)) ? 'Clear this building' : 'Select all in this building'}
                    </Text>
                  </TouchableOpacity>
                  <View style={s.flats}>
                    {flatList.map((f: { id: string; flatCode: string }) => {
                      const on = value.flatIds.includes(f.id);
                      return (
                        <TouchableOpacity
                          key={f.id}
                          style={[s.flat, on && s.flatOn]}
                          onPress={() => onChange({ ...value, flatIds: toggleId(value.flatIds, f.id) })}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`Flat ${f.flatCode}`}
                        >
                          <Text style={[s.flatText, on && s.flatTextOn]}>{f.flatCode}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
              {value.flatIds.length > 0 && <Text style={s.hint}>{value.flatIds.length} flat{value.flatIds.length === 1 ? '' : 's'} chosen across all buildings</Text>}
            </>
          )}
        </View>
      )}

      {value.kind === 'COMMITTEE' && <Text style={s.hint}>Only committee members get this.</Text>}
      {value.kind === 'STAFF' && <Text style={s.hint}>Only staff members get this.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.sm },
  kinds: { flexGrow: 0, flexShrink: 0 },
  kindsContent: { gap: spacing.sm, paddingVertical: 2 },
  kind: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  kindOn: { backgroundColor: tint(tones.teal, 0.88), borderColor: tint(tones.teal, 0.5) },
  kindText: { ...typography.labelMedium, color: colors.textSecondary, textTransform: 'none', letterSpacing: 0 },
  kindTextOn: { color: colors.primary },
  box: { gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  rowText: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  flats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flat: { minWidth: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center' },
  flatOn: { backgroundColor: tones.teal, borderColor: tones.teal },
  flatText: { ...typography.labelMedium, color: colors.text, textTransform: 'none', letterSpacing: 0 },
  flatTextOn: { color: '#FFFFFF' },
  link: { ...typography.labelMedium, color: colors.primary, textDecorationLine: 'underline', textTransform: 'none', letterSpacing: 0 },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
});
