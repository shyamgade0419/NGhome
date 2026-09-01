/**
 * Admin — Maintenance Sheet
 * Shows the monthly per-flat maintenance summary with paid/pending status,
 * amounts, and per-flat notes. Mirrors the web maintenance sheet view.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ScrollView,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { BillingPeriod, billingPeriodName } from '@/types/billing.types';

// ── Types ────────────────────────────────────────────────────────────────────

interface FlatRow {
  flatId: string;
  flatCode: string;
  buildingName?: string;
  ownerName?: string;
  phone?: string | null;
  totalAmount: string;
  paidAmount: string;
  pendingAmount: string;
  isPaid: boolean;
  isPublished: boolean;
  invoiceNumber?: string;
  maintenanceNotes?: string | null;
  billId?: string;
}

// ── Period selector ───────────────────────────────────────────────────────────

function PeriodPicker({
  periods,
  selected,
  onSelect,
}: {
  periods: BillingPeriod[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.periodRow}
    >
      {periods.map((p) => (
        <TouchableOpacity
          key={p.id}
          style={[styles.periodChip, selected === p.id && styles.periodChipActive]}
          onPress={() => onSelect(p.id)}
        >
          <Text style={[styles.periodChipText, selected === p.id && styles.periodChipTextActive]}>
            {MONTHS[(p.periodMonth ?? 1)]} {p.periodYear}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Notes modal ───────────────────────────────────────────────────────────────

function NotesModal({
  flat,
  onClose,
}: {
  flat: FlatRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState(flat.maintenanceNotes ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/maintenance-sheet/notes`, {
        flatId: flat.flatId,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-sheet'] });
      Alert.alert('Saved', 'Note updated for this flat.');
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save note.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalTitle}>Notes — Flat {flat.flatCode}</Text>
            {flat.ownerName && (
              <Text style={styles.modalSub}>{flat.ownerName}</Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.noteHint}>
              Add notes for this flat — visible to all committee members and the resident.
            </Text>
            <TextInput
              style={styles.noteInput}
              placeholder="e.g. Partial payment agreed, Leakage reported, pending repair…"
              placeholderTextColor={colors.textTertiary}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              autoFocus
            />
            <TouchableOpacity
              style={[styles.saveBtn, mutation.isPending && styles.saveBtnDisabled]}
              onPress={() => mutation.mutate()}
              disabled={mutation.isPending}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>
                {mutation.isPending ? 'Saving…' : 'Save Note'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Flat row card ─────────────────────────────────────────────────────────────

function FlatCard({
  flat,
  onNotePress,
}: {
  flat: FlatRow;
  onNotePress: (f: FlatRow) => void;
}) {
  const total = parseFloat(flat.totalAmount || '0');
  const paid = parseFloat(flat.paidAmount || '0');
  const pending = parseFloat(flat.pendingAmount || '0');

  return (
    <View style={[styles.flatCard, flat.isPaid && styles.flatCardPaid]}>
      {/* Status stripe */}
      <View style={[styles.stripe, { backgroundColor: flat.isPaid ? colors.success : colors.warning }]} />

      <View style={styles.flatCardBody}>
        {/* Header row */}
        <View style={styles.flatCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.flatCode}>Flat {flat.flatCode}</Text>
            {flat.buildingName && (
              <Text style={styles.buildingName}>{flat.buildingName}</Text>
            )}
            {flat.ownerName && (
              <Text style={styles.ownerName}>{flat.ownerName}</Text>
            )}
          </View>
          <View style={styles.flatCardRight}>
            <StatusBadge
              label={flat.isPaid ? 'PAID' : 'PENDING'}
              variant={flat.isPaid ? 'success' : 'warning'}
            />
          </View>
        </View>

        {/* Amount row */}
        <View style={styles.amountRow}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Total</Text>
            <Text style={styles.amountValue}>₹{total.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Paid</Text>
            <Text style={[styles.amountValue, { color: colors.success }]}>
              ₹{paid.toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Pending</Text>
            <Text style={[styles.amountValue, { color: pending > 0 ? colors.warning : colors.success }]}>
              ₹{pending.toLocaleString('en-IN')}
            </Text>
          </View>
        </View>

        {/* Note (if any) */}
        {flat.maintenanceNotes && (
          <View style={styles.noteRow}>
            <Ionicons name="document-text-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.noteText} numberOfLines={2}>{flat.maintenanceNotes}</Text>
          </View>
        )}

        {/* Note button */}
        <TouchableOpacity style={styles.noteBtn} onPress={() => onNotePress(flat)} activeOpacity={0.7}>
          <Ionicons
            name={flat.maintenanceNotes ? 'create-outline' : 'add-circle-outline'}
            size={14}
            color={colors.primary}
          />
          <Text style={styles.noteBtnText}>
            {flat.maintenanceNotes ? 'Edit note' : 'Add note'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function MaintenanceSheetScreen() {
  const qc = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterPaid, setFilterPaid] = useState<'ALL' | 'PAID' | 'PENDING'>('ALL');
  const [editingFlat, setEditingFlat] = useState<FlatRow | null>(null);

  // Load billing periods
  const { data: periodsData } = useQuery({
    queryKey: ['billing-periods-sheet'],
    // React Query v5 removed the onSuccess callback — the default period is
    // selected by the effect below instead.
    queryFn: () => billingApi.getBillingPeriods({ limit: 24 }),
  });

  const periods: BillingPeriod[] = periodsData?.data ?? [];

  // Ensure we set a default when periods load
  React.useEffect(() => {
    if (!selectedPeriodId && periods.length > 0) {
      const published = periods.find((p) => p.status === 'PUBLISHED');
      setSelectedPeriodId(published?.id ?? periods[0]?.id ?? null);
    }
  }, [periods, selectedPeriodId]);

  // Load maintenance sheet for selected period
  const { data: sheetData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['maintenance-sheet', selectedPeriodId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: FlatRow[] }>(
        `/billing/periods/${selectedPeriodId}/sheet`,
      );
      return res.data.data ?? [];
    },
    enabled: !!selectedPeriodId,
  });

  const rows: FlatRow[] = sheetData ?? [];

  // Stats
  const totalFlats = rows.length;
  const paidFlats = rows.filter((r) => r.isPaid).length;
  const totalCollected = rows.reduce((s, r) => s + parseFloat(r.paidAmount || '0'), 0);
  const totalPending = rows.reduce((s, r) => s + parseFloat(r.pendingAmount || '0'), 0);

  // Filter + search
  const filtered = rows.filter((r) => {
    const matchSearch = !search.trim() || [r.flatCode, r.ownerName ?? ''].join(' ').toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filterPaid === 'ALL' ||
      (filterPaid === 'PAID' && r.isPaid) ||
      (filterPaid === 'PENDING' && !r.isPaid);
    return matchSearch && matchFilter;
  });

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Maintenance Sheet"
        showBack
        rightAction={
          <TouchableOpacity onPress={() => refetch()} hitSlop={8}>
            <Ionicons name="refresh-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      {/* Period selector */}
      {periods.length > 0 && (
        <View style={styles.periodWrap}>
          <PeriodPicker
            periods={periods}
            selected={selectedPeriodId ?? ''}
            onSelect={setSelectedPeriodId}
          />
        </View>
      )}

      {/* Summary banner */}
      {rows.length > 0 && (
        <View style={styles.summaryBanner}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{paidFlats}/{totalFlats}</Text>
            <Text style={styles.summaryLabel}>Paid</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.success }]}>
              ₹{(totalCollected / 1000).toFixed(1)}K
            </Text>
            <Text style={styles.summaryLabel}>Collected</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.warning }]}>
              ₹{(totalPending / 1000).toFixed(1)}K
            </Text>
            <Text style={styles.summaryLabel}>Pending</Text>
          </View>
        </View>
      )}

      {/* Search + filter */}
      <View style={styles.searchFilter}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={15} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search flat or owner…"
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.filterBtns}>
          {(['ALL', 'PAID', 'PENDING'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filterPaid === f && styles.filterBtnActive]}
              onPress={() => setFilterPaid(f)}
            >
              <Text style={[styles.filterBtnText, filterPaid === f && styles.filterBtnTextActive]}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Notes modal */}
      {editingFlat && (
        <NotesModal flat={editingFlat} onClose={() => setEditingFlat(null)} />
      )}

      {isLoading ? (
        <LoadingState message="Loading maintenance sheet…" />
      ) : !selectedPeriodId ? (
        <EmptyState icon="receipt-outline" title="No billing periods" description="Create a billing period first." />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="home-outline"
          title={search ? 'No matches' : 'No flats found'}
          description={search ? 'Try a different search term.' : 'Bills may not have been generated for this period yet.'}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.flatId}
          renderItem={({ item }) => (
            <FlatCard flat={item} onNotePress={setEditingFlat} />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  periodWrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  periodRow: { paddingHorizontal: spacing.base, paddingVertical: spacing.sm, gap: spacing.sm },
  periodChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  periodChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  periodChipText: { ...typography.labelSmall, color: colors.textSecondary },
  periodChipTextActive: { color: colors.primary },

  summaryBanner: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { ...typography.headingSmall, color: colors.text },
  summaryLabel: { ...typography.labelSmall, color: colors.textSecondary, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: colors.border, marginVertical: 4 },

  searchFilter: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  searchInput: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.text,
    padding: 0,
  },
  filterBtns: { flexDirection: 'row', gap: spacing.sm },
  filterBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterBtnText: { ...typography.labelSmall, color: colors.textSecondary },
  filterBtnTextActive: { color: colors.primary },

  list: { padding: spacing.sm },

  flatCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  flatCardPaid: { borderColor: '#BBF7D0' },
  stripe: { width: 4, flexShrink: 0 },
  flatCardBody: { flex: 1, padding: spacing.md, gap: spacing.sm },

  flatCardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  flatCardRight: { alignItems: 'flex-end' },

  flatCode: { ...typography.labelLarge, color: colors.text, fontWeight: '700' },
  buildingName: { ...typography.bodySmall, color: colors.textSecondary },
  ownerName: { ...typography.bodySmall, color: colors.textSecondary },

  amountRow: { flexDirection: 'row', gap: spacing.xl },
  amountItem: { gap: 2 },
  amountLabel: { ...typography.labelSmall, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  amountValue: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },

  noteRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' },
  noteText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1, lineHeight: 17 },

  noteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
  },
  noteBtnText: { ...typography.labelSmall, color: colors.primary },

  // Modal
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  modalContent: { padding: spacing.base, gap: spacing.base },
  noteHint: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 18 },
  noteInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.bodyMedium,
    color: colors.text,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { ...typography.labelLarge, color: '#fff' },
});
