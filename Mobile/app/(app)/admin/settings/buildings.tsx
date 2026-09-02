/**
 * Admin — Buildings & Flats
 *
 * Was read-only ("managed from the web dashboard"). The backend has always
 * supported full create/update/delete for both — SOCIETY_ADMIN only — this
 * just wires it up. Note: the web dashboard itself only ever wired up
 * create, not edit/delete, so this screen actually goes a step further
 * than web today.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { useIsSocietyAdmin } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { Building, Flat, FlatStatus } from '@/types/society.types';

const FLAT_STATUSES: FlatStatus[] = ['VACANT', 'ACTIVE', 'UNDER_RENOVATION', 'INACTIVE'];

// ── Add / Edit Building ──────────────────────────────────────────────────

function BuildingFormModal({
  building,
  onClose,
}: {
  building: Building | null; // null = create
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: building?.name ?? '',
    code: building?.code ?? '',
    totalFloors: building?.totalFloors?.toString() ?? '',
    description: building?.description ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        totalFloors: form.totalFloors ? parseInt(form.totalFloors, 10) : undefined,
        description: form.description.trim() || undefined,
      };
      return building ? societiesApi.updateBuilding(building.id, payload) : societiesApi.createBuilding(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-buildings'] });
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save building.'),
  });

  const removeMutation = useMutation({
    mutationFn: () => societiesApi.deleteBuilding(building!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-buildings'] });
      qc.invalidateQueries({ queryKey: ['admin-flats-all'] });
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to delete building.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{building ? 'Edit Building' : 'Add Building'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Building Name *</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="Block A"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Code</Text>
            <TextInput
              style={styles.input}
              value={form.code}
              onChangeText={(v) => setForm((f) => ({ ...f, code: v }))}
              placeholder="A"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Total Floors</Text>
            <TextInput
              style={styles.input}
              value={form.totalFloors}
              onChangeText={(v) => setForm((f) => ({ ...f, totalFloors: v.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad"
              placeholder="10"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Description</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Main residential block"
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <Button
              label={mutation.isPending ? 'Saving…' : building ? 'Save Changes' : 'Create Building'}
              onPress={() => {
                if (!form.name.trim()) {
                  Alert.alert('Required', 'Enter a building name.');
                  return;
                }
                mutation.mutate();
              }}
              loading={mutation.isPending}
              fullWidth
              style={{ marginTop: spacing.xl }}
            />

            {building && (
              <Button
                label={removeMutation.isPending ? 'Deleting…' : 'Delete Building'}
                onPress={() =>
                  Alert.alert(
                    'Delete Building',
                    `Remove "${building.name}"? Flats inside it are unaffected but will need reassigning.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => removeMutation.mutate() },
                    ],
                  )
                }
                loading={removeMutation.isPending}
                variant="danger"
                fullWidth
                style={{ marginTop: spacing.sm }}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Add / Edit Flat ──────────────────────────────────────────────────────

function FlatFormModal({
  flat,
  buildings,
  defaultBuildingId,
  onClose,
}: {
  flat: Flat | null; // null = create
  buildings: Building[];
  defaultBuildingId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    buildingId: flat?.buildingId ?? defaultBuildingId ?? buildings[0]?.id ?? '',
    unitNumber: flat?.unitNumber ?? '',
    flatCode: flat?.flatCode ?? '',
    area: flat?.area ?? '',
    bedrooms: flat?.bedrooms?.toString() ?? '',
    bathrooms: flat?.bathrooms?.toString() ?? '',
    category: flat?.category ?? '',
    status: flat?.status ?? ('VACANT' as FlatStatus),
    ownershipType: flat?.ownershipType ?? '',
    parkingSlots: flat?.parkingSlots?.toString() ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        buildingId: form.buildingId,
        unitNumber: form.unitNumber.trim(),
        flatCode: form.flatCode.trim(),
        area: form.area ? parseFloat(form.area) : undefined,
        bedrooms: form.bedrooms ? parseInt(form.bedrooms, 10) : undefined,
        bathrooms: form.bathrooms ? parseInt(form.bathrooms, 10) : undefined,
        category: form.category.trim() || undefined,
        status: form.status,
        ownershipType: form.ownershipType.trim() || undefined,
        parkingSlots: form.parkingSlots ? parseInt(form.parkingSlots, 10) : undefined,
      };
      return flat ? societiesApi.updateFlat(flat.id, payload) : societiesApi.createFlat(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-flats-all'] });
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save flat.'),
  });

  const removeMutation = useMutation({
    mutationFn: () => societiesApi.deleteFlat(flat!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-flats-all'] });
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to delete flat.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{flat ? 'Edit Flat' : 'Add Flat'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Building *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {buildings.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.chip, form.buildingId === b.id && styles.chipActive]}
                  onPress={() => setForm((f) => ({ ...f, buildingId: b.id }))}
                >
                  <Text style={[styles.chipText, form.buildingId === b.id && styles.chipTextActive]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Unit Number *</Text>
                <TextInput
                  style={styles.input}
                  value={form.unitNumber}
                  onChangeText={(v) => setForm((f) => ({ ...f, unitNumber: v }))}
                  placeholder="101"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Flat Code *</Text>
                <TextInput
                  style={styles.input}
                  value={form.flatCode}
                  onChangeText={(v) => setForm((f) => ({ ...f, flatCode: v }))}
                  placeholder="A-101"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>

            <View style={styles.row3}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Area (sq ft)</Text>
                <TextInput
                  style={styles.input}
                  value={form.area}
                  onChangeText={(v) => setForm((f) => ({ ...f, area: v.replace(/[^0-9.]/g, '') }))}
                  keyboardType="decimal-pad"
                  placeholder="850"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Bedrooms</Text>
                <TextInput
                  style={styles.input}
                  value={form.bedrooms}
                  onChangeText={(v) => setForm((f) => ({ ...f, bedrooms: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="number-pad"
                  placeholder="2"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Bathrooms</Text>
                <TextInput
                  style={styles.input}
                  value={form.bathrooms}
                  onChangeText={(v) => setForm((f) => ({ ...f, bathrooms: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="number-pad"
                  placeholder="2"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Category</Text>
                <TextInput
                  style={styles.input}
                  value={form.category}
                  onChangeText={(v) => setForm((f) => ({ ...f, category: v }))}
                  placeholder="2BHK"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Parking Slots</Text>
                <TextInput
                  style={styles.input}
                  value={form.parkingSlots}
                  onChangeText={(v) => setForm((f) => ({ ...f, parkingSlots: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>

            <Text style={[styles.label, { marginTop: spacing.base }]}>Ownership Type</Text>
            <TextInput
              style={styles.input}
              value={form.ownershipType}
              onChangeText={(v) => setForm((f) => ({ ...f, ownershipType: v }))}
              placeholder="OWNED / RENTED"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {FLAT_STATUSES.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, form.status === s && styles.chipActive]}
                  onPress={() => setForm((f) => ({ ...f, status: s }))}
                >
                  <Text style={[styles.chipText, form.status === s && styles.chipTextActive]}>
                    {s.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Button
              label={mutation.isPending ? 'Saving…' : flat ? 'Save Changes' : 'Create Flat'}
              onPress={() => {
                if (!form.buildingId || !form.unitNumber.trim() || !form.flatCode.trim()) {
                  Alert.alert('Required', 'Building, unit number and flat code are required.');
                  return;
                }
                mutation.mutate();
              }}
              loading={mutation.isPending}
              fullWidth
              style={{ marginTop: spacing.xl }}
            />

            {flat && (
              <Button
                label={removeMutation.isPending ? 'Deleting…' : 'Delete Flat'}
                onPress={() =>
                  Alert.alert('Delete Flat', `Remove flat ${flat.flatCode}? This cannot be undone.`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => removeMutation.mutate() },
                  ])
                }
                loading={removeMutation.isPending}
                variant="danger"
                fullWidth
                style={{ marginTop: spacing.sm }}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Flat chip ──────────────────────────────────────────────────────
function FlatChip({ flat, onPress }: { flat: Flat; onPress: () => void }) {
  return (
    <TouchableOpacity style={chipStyles.chip} onPress={onPress} activeOpacity={0.7}>
      <Text style={chipStyles.label}>{flat.flatCode}</Text>
    </TouchableOpacity>
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
function BuildingCard({
  building,
  flats,
  canManage,
  onEditBuilding,
  onAddFlat,
  onEditFlat,
}: {
  building: Building;
  flats: Flat[];
  canManage: boolean;
  onEditBuilding: () => void;
  onAddFlat: () => void;
  onEditFlat: (flat: Flat) => void;
}) {
  const activeFlats = flats.filter((f) => f.isActive);
  const vacantFlats = flats.filter((f) => !f.isActive);

  return (
    <Card style={cardStyles.card}>
      {/* Header */}
      <TouchableOpacity
        style={cardStyles.header}
        onPress={canManage ? onEditBuilding : undefined}
        activeOpacity={canManage ? 0.7 : 1}
      >
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
        {canManage && <Ionicons name="create-outline" size={16} color={colors.textTertiary} />}
      </TouchableOpacity>

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
      <View style={cardStyles.flatsSection}>
        <View style={cardStyles.flatsSectionHeader}>
          <Text style={cardStyles.flatsLabel}>Active Flats</Text>
          {canManage && (
            <TouchableOpacity style={cardStyles.addFlatBtn} onPress={onAddFlat} hitSlop={6}>
              <Ionicons name="add" size={14} color={colors.primary} />
              <Text style={cardStyles.addFlatText}>Add Flat</Text>
            </TouchableOpacity>
          )}
        </View>
        {activeFlats.length > 0 ? (
          <View style={cardStyles.flatsGrid}>
            {activeFlats.slice(0, 30).map((f) => (
              <FlatChip key={f.id} flat={f} onPress={() => onEditFlat(f)} />
            ))}
            {activeFlats.length > 30 && (
              <View style={chipStyles.chip}>
                <Text style={chipStyles.label}>+{activeFlats.length - 30} more</Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={cardStyles.noFlats}>No flats yet</Text>
        )}
      </View>
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
  flatsSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flatsLabel: { ...typography.labelSmall, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  addFlatBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  addFlatText: { ...typography.labelSmall, color: colors.primary, fontWeight: '600' },
  flatsGrid: { flexDirection: 'row', flexWrap: 'wrap', margin: -2 },
  noFlats: { ...typography.bodySmall, color: colors.textTertiary },
});

// ── Main screen ────────────────────────────────────────────────────
export default function BuildingsScreen() {
  const canManage = useIsSocietyAdmin();
  const [editingBuilding, setEditingBuilding] = useState<Building | null>(null);
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [editingFlat, setEditingFlat] = useState<Flat | null>(null);
  const [addFlatFor, setAddFlatFor] = useState<string | null>(null); // buildingId

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
  const showFlatForm = editingFlat !== null || addFlatFor !== null;

  if (isLoading) return <LoadingState fullscreen message="Loading buildings…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Buildings & Flats"
        showBack
        subtitle={`${buildings.length} building${buildings.length !== 1 ? 's' : ''} · ${allFlats.filter((f) => f.isActive).length} flats`}
        rightAction={
          canManage ? (
            <TouchableOpacity onPress={() => setShowAddBuilding(true)} hitSlop={8}>
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          ) : undefined
        }
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
            canManage={canManage}
            onEditBuilding={() => setEditingBuilding(building)}
            onAddFlat={() => setAddFlatFor(building.id)}
            onEditFlat={setEditingFlat}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="business-outline"
            title="No buildings yet"
            description={canManage ? 'Add your first building to get started.' : 'Buildings appear here once your admin adds them.'}
          />
        }
        ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
      />

      {(showAddBuilding || editingBuilding) && (
        <BuildingFormModal
          building={editingBuilding}
          onClose={() => {
            setShowAddBuilding(false);
            setEditingBuilding(null);
          }}
        />
      )}

      {showFlatForm && (
        <FlatFormModal
          flat={editingFlat}
          buildings={buildings}
          defaultBuildingId={addFlatFor ?? undefined}
          onClose={() => {
            setEditingFlat(null);
            setAddFlatFor(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base },

  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text, fontWeight: '700' },
  modalBody: { padding: spacing.base },

  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  textarea: { minHeight: 72, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.base },
  row3: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.base },

  chipScroll: { marginTop: 6, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
});
