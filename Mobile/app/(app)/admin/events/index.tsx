/**
 * Admin — Events & Planned Activities
 *
 * One model covers two things: real society events (Diwali, AGM) and
 * admin-planned upcoming activities with a known or estimated cost (AMC
 * servicing, water tank cleaning) — same shape either way, a title, a date,
 * and an optional cost. Linking a Fund while planning is informational
 * only — estimating a cost against a fund doesn't move any money. Once the
 * actual cost is known, "Record Actual Cost as Expense" in the detail view
 * is the explicit action that turns it into a real Expense and debits the
 * linked fund (see EventsService.recordExpense on the backend) — a
 * deliberate two-step split so editing a rough estimate never silently
 * touches the ledger.
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
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { eventsApi, SocietyEvent, EventStatus, EventPayload } from '@/api/endpoints/events.api';
import { fundsApi } from '@/api/endpoints/accounts.api';
import { useIsSocietyAdmin, useIsRole } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { inr } from '@/utils/format';

const STATUS_OPTIONS: EventStatus[] = ['PLANNED', 'COMPLETED', 'CANCELLED'];

function statusVariant(status: EventStatus): 'info' | 'success' | 'neutral' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED') return 'neutral';
  return 'info';
}

// ── Create / Edit form ──────────────────────────────────────────────────────

function EventFormModal({
  event,
  onClose,
}: {
  event: SocietyEvent | null; // null = create
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [showDate, setShowDate] = useState(false);
  const [form, setForm] = useState({
    title: event?.title ?? '',
    description: event?.description ?? '',
    eventDate: (event?.eventDate ?? new Date().toISOString()).split('T')[0],
    fundId: event?.fundId ?? null as string | null,
    estimatedCost: event?.estimatedCost ?? '',
    actualCost: event?.actualCost ?? '',
    status: event?.status ?? ('PLANNED' as EventStatus),
    isVisibleToResidents: event?.isVisibleToResidents ?? true,
  });

  const { data: funds } = useQuery({ queryKey: ['funds-for-events'], queryFn: fundsApi.list });

  const mutation = useMutation({
    mutationFn: () => {
      const payload: EventPayload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        eventDate: new Date(form.eventDate).toISOString(),
        fundId: form.fundId,
        estimatedCost: form.estimatedCost ? parseFloat(form.estimatedCost) : undefined,
        actualCost: form.actualCost ? parseFloat(form.actualCost) : undefined,
        status: form.status,
        isVisibleToResidents: form.isVisibleToResidents,
      };
      return event ? eventsApi.update(event.id, payload) : eventsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      Alert.alert(event ? 'Saved' : 'Added', event ? 'Event updated.' : 'Event added.');
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save event.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{event ? 'Edit Event' : 'New Event / Activity'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
              placeholder="e.g. Diwali Celebration, Water Tank Cleaning"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Date *</Text>
            <TouchableOpacity style={styles.dateTouchable} onPress={() => setShowDate(true)} activeOpacity={0.7}>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.dateText}>
                {new Date(form.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </TouchableOpacity>
            {showDate && (
              <DateTimePicker
                value={new Date(form.eventDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_: DateTimePickerEvent, d?: Date) => {
                  setShowDate(Platform.OS === 'ios');
                  if (d) setForm((f) => ({ ...f, eventDate: d.toISOString().split('T')[0] }));
                }}
              />
            )}

            <Text style={[styles.label, { marginTop: spacing.base }]}>Description</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="What's happening and any details residents should know"
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {STATUS_OPTIONS.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, form.status === s && styles.chipActive]}
                  onPress={() => setForm((f) => ({ ...f, status: s }))}
                >
                  <Text style={[styles.chipText, form.status === s && styles.chipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.label, { marginTop: spacing.base }]}>Linked Fund</Text>
            <Text style={styles.hint}>Optional, informational only — doesn&apos;t move any money.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <TouchableOpacity
                style={[styles.chip, !form.fundId && styles.chipActive]}
                onPress={() => setForm((f) => ({ ...f, fundId: null }))}
              >
                <Text style={[styles.chipText, !form.fundId && styles.chipTextActive]}>None</Text>
              </TouchableOpacity>
              {(funds ?? []).map((fund) => (
                <TouchableOpacity
                  key={fund.id}
                  style={[styles.chip, form.fundId === fund.id && styles.chipActive]}
                  onPress={() => setForm((f) => ({ ...f, fundId: fund.id }))}
                >
                  <Text style={[styles.chipText, form.fundId === fund.id && styles.chipTextActive]}>
                    {fund.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.costRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Estimated Cost (₹)</Text>
                <TextInput
                  style={styles.input}
                  value={form.estimatedCost}
                  onChangeText={(v) => setForm((f) => ({ ...f, estimatedCost: v.replace(/[^0-9.]/g, '') }))}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Actual Cost (₹)</Text>
                <TextInput
                  style={styles.input}
                  value={form.actualCost}
                  onChangeText={(v) => setForm((f) => ({ ...f, actualCost: v.replace(/[^0-9.]/g, '') }))}
                  keyboardType="decimal-pad"
                  placeholder="Once known"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Visible to Residents</Text>
                <Text style={styles.hint}>Off keeps this purely an internal planning note.</Text>
              </View>
              <Switch
                value={form.isVisibleToResidents}
                onValueChange={(v) => setForm((f) => ({ ...f, isVisibleToResidents: v }))}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>

            <Button
              label={mutation.isPending ? 'Saving…' : event ? 'Save Changes' : 'Add Event'}
              onPress={() => {
                if (!form.title.trim()) {
                  Alert.alert('Required', 'Enter a title.');
                  return;
                }
                mutation.mutate();
              }}
              loading={mutation.isPending}
              fullWidth
              style={{ marginTop: spacing.xl }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Detail sheet ─────────────────────────────────────────────────────────────

function EventDetailModal({
  event,
  canWrite,
  canDelete,
  onClose,
  onEdit,
}: {
  event: SocietyEvent;
  canWrite: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: () => eventsApi.remove(event.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to delete event.'),
  });

  // Linking a fund above is informational only — it never moves money by
  // itself (see the form's own copy). This is the explicit action that
  // actually records the spend: a real Expense (shows up in reports) plus
  // a debit against the fund's balance.
  const recordExpense = useMutation({
    mutationFn: () => eventsApi.recordExpense(event.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      Alert.alert('Recorded', 'Added as an expense and debited from the linked fund.');
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to record expense.'),
  });

  const unrecordExpense = useMutation({
    mutationFn: () => eventsApi.unrecordExpense(event.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      Alert.alert('Undone', 'The expense was removed and the money returned to the fund.');
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to undo.'),
  });

  const canRecordExpense = canWrite && !!event.actualCost && !!event.fundId && !event.expenseRecorded;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle} numberOfLines={1}>{event.title}</Text>
            <Text style={styles.modalSub}>
              {new Date(event.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <StatusBadge label={event.status} variant={statusVariant(event.status)} />

          {event.description ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Description</Text>
              <Text style={styles.blockText}>{event.description}</Text>
            </View>
          ) : null}

          {(event.estimatedCost || event.actualCost) ? (
            <View style={styles.costCard}>
              {event.estimatedCost ? (
                <View style={styles.costCardRow}>
                  <Text style={styles.blockLabel}>Estimated</Text>
                  <Text style={styles.blockText}>{inr(event.estimatedCost)}</Text>
                </View>
              ) : null}
              {event.actualCost ? (
                <View style={styles.costCardRow}>
                  <Text style={styles.blockLabel}>Actual</Text>
                  <Text style={[styles.blockText, { color: colors.primary, fontWeight: '700' }]}>
                    {inr(event.actualCost)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {event.fund ? (
            <View style={styles.infoRow}>
              <Ionicons name="shield-checkmark-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.infoText}>Linked to {event.fund.name}</Text>
            </View>
          ) : null}

          {event.expenseRecorded ? (
            <>
              <View style={styles.recordedRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.secondary} />
                <Text style={styles.recordedText}>Recorded as an expense — the fund balance reflects this spend.</Text>
              </View>
              {canWrite && (
                <TouchableOpacity
                  style={styles.undoBtn}
                  onPress={() =>
                    Alert.alert(
                      'Undo Recording',
                      `Remove this expense and put ${inr(event.actualCost!)} back into ${event.fund?.name ?? 'the fund'}? Not possible once it has been paid from an account.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Undo',
                          style: 'destructive',
                          onPress: () => unrecordExpense.mutate(),
                        },
                      ],
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons name="arrow-undo-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.undoText}>
                    {unrecordExpense.isPending ? 'Undoing…' : 'Undo recording'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : canRecordExpense ? (
            <Button
              label={recordExpense.isPending ? 'Recording…' : 'Record Actual Cost as Expense'}
              onPress={() =>
                Alert.alert(
                  'Record as Expense',
                  `Add ${inr(event.actualCost!)} as an expense and debit it from ${event.fund?.name}? You can undo this later, until it's paid from an account.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Record', onPress: () => recordExpense.mutate() },
                  ],
                )
              }
              loading={recordExpense.isPending}
              variant="outline"
              fullWidth
              style={{ marginTop: spacing.xs }}
            />
          ) : null}

          <View style={styles.infoRow}>
            <Ionicons
              name={event.isVisibleToResidents ? 'eye-outline' : 'eye-off-outline'}
              size={15}
              color={colors.textSecondary}
            />
            <Text style={styles.infoText}>
              {event.isVisibleToResidents ? 'Visible to residents' : 'Internal only — hidden from residents'}
            </Text>
          </View>

          {event.createdBy ? (
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.infoText}>
                Added by {event.createdBy.firstName} {event.createdBy.lastName}
              </Text>
            </View>
          ) : null}

          {canWrite && (
            <Button label="Edit" onPress={onEdit} variant="outline" fullWidth style={{ marginTop: spacing.xl }} />
          )}
          {canDelete && (
            <Button
              label={remove.isPending ? 'Deleting…' : 'Delete Event'}
              onPress={() =>
                Alert.alert('Delete Event', `Remove "${event.title}"? This cannot be undone.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
                ])
              }
              loading={remove.isPending}
              variant="danger"
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          )}
          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function AdminEventsScreen() {
  const [selected, setSelected] = useState<SocietyEvent | null>(null);
  const [editing, setEditing] = useState<SocietyEvent | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Matches the backend RolesGuard exactly: create/update is ADMIN/ACCOUNTANT/
  // COMMITTEE_MEMBER; delete is ADMIN only. Society staff can view the admin
  // app but the API would 403 them on writes, so those actions stay hidden.
  const canWrite = useIsRole('SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT', 'COMMITTEE_MEMBER');
  const canDelete = useIsSocietyAdmin();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['events'],
    queryFn: () => eventsApi.list({ limit: 50 }),
  });

  const events = data?.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Events & Activities"
        showBack
        rightAction={
          canWrite ? (
            <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={8}>
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingState message="Loading events…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load events" description="Pull down to retry." />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} activeOpacity={0.8} onPress={() => setSelected(item)}>
              <View style={styles.dateChip}>
                <Text style={styles.dateDay}>
                  {new Date(item.eventDate).toLocaleDateString('en-IN', { day: 'numeric' })}
                </Text>
                <Text style={styles.dateMon}>
                  {new Date(item.eventDate).toLocaleDateString('en-IN', { month: 'short' })}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.badgeRow}>
                  <StatusBadge label={item.status} variant={statusVariant(item.status)} size="sm" />
                  {!item.isVisibleToResidents && (
                    <Ionicons name="eye-off-outline" size={12} color={colors.textTertiary} />
                  )}
                  {(item.estimatedCost || item.actualCost) ? (
                    <Text style={styles.rowMeta}>
                      · {inr(item.actualCost || item.estimatedCost)}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="sparkles-outline"
              title="No events yet"
              description="Society events and planned activities like AMC servicing or tank cleaning appear here."
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {selected && (
        <EventDetailModal
          event={selected}
          canWrite={canWrite}
          canDelete={canDelete}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
        />
      )}
      {(showCreate || editing) && (
        <EventFormModal
          event={editing}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },
  dateChip: {
    width: 46, height: 46, borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  dateDay: { ...typography.headingSmall, color: colors.primary, fontWeight: '700', lineHeight: 20 },
  dateMon: { ...typography.labelSmall, color: colors.primary, fontSize: 10, textTransform: 'uppercase' },

  rowTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  rowMeta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },
  modalBody: { padding: spacing.base, gap: spacing.sm },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { ...typography.bodyMedium, color: colors.textSecondary },
  recordedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.secondaryLight, borderRadius: radius.md,
    padding: spacing.sm,
  },
  recordedText: { ...typography.bodySmall, color: colors.secondary, flex: 1 },
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  undoText: { ...typography.labelMedium, color: colors.textSecondary },

  block: { gap: 4 },
  blockLabel: {
    ...typography.labelSmall, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  blockText: { ...typography.bodyMedium, color: colors.text, lineHeight: 21 },

  costCard: {
    flexDirection: 'row', gap: spacing.xl,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  costCardRow: { gap: 2 },

  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4 },
  hint: { ...typography.bodySmall, color: colors.textTertiary, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  textarea: { minHeight: 72, textAlignVertical: 'top' },
  costRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.base },

  dateTouchable: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  dateText: { ...typography.bodyMedium, color: colors.text },

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

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.base,
  },
});
