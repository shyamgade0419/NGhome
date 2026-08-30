import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Modal, ScrollView, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { helpdeskApi, MaintenanceRequest } from '@/api/endpoints/helpdesk.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

const STATUS_COLOR: Record<string, string> = {
  OPEN: colors.warning,
  IN_PROGRESS: colors.info,
  RESOLVED: colors.success,
  CLOSED: colors.textTertiary,
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW: colors.textTertiary,
  MEDIUM: colors.info,
  HIGH: colors.warning,
  URGENT: colors.error,
};

function UpdateModal({
  request,
  onClose,
}: {
  request: MaintenanceRequest;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.adminNotes ?? '');

  const mutation = useMutation({
    mutationFn: () => helpdeskApi.updateStatus(request.id, {
      status,
      adminNotes: notes.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helpdesk-admin'] });
      Alert.alert('Updated', 'Request status updated successfully.');
      onClose();
    },
    onError: () => Alert.alert('Error', 'Failed to update. Please try again.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{request.title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          {request.description && (
            <View style={styles.descBox}>
              <Text style={styles.descLabel}>Issue Description</Text>
              <Text style={styles.descText}>{request.description}</Text>
            </View>
          )}

          <Text style={styles.fieldLabel}>Update Status</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.statusChip, status === s && { borderColor: STATUS_COLOR[s], backgroundColor: STATUS_COLOR[s] + '18' }]}
                onPress={() => setStatus(s)}
              >
                <Text style={[styles.statusChipText, status === s && { color: STATUS_COLOR[s] }]}>
                  {s.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Admin Notes (shown to resident)</Text>
          <Text style={styles.notesHint}>Update for the resident — what was done, ETA, etc.</Text>
          <TextInput
            style={styles.textArea}
            placeholder="e.g. Plumber will visit tomorrow between 10am–12pm"
            placeholderTextColor={colors.textTertiary}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <Button
            label={`Update to ${status.replace('_', ' ')}`}
            onPress={() => mutation.mutate()}
            loading={mutation.isPending}
            fullWidth
            size="lg"
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function RequestCard({ req, onUpdate }: { req: MaintenanceRequest; onUpdate: (r: MaintenanceRequest) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.priorityBar, { backgroundColor: PRIORITY_COLOR[req.priority] }]} />
        <View style={styles.cardMain}>
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle} numberOfLines={2}>{req.title}</Text>
            <View style={[styles.statusPill, { borderColor: STATUS_COLOR[req.status] }]}>
              <Text style={[styles.statusPillText, { color: STATUS_COLOR[req.status] }]}>
                {req.status.replace('_', ' ')}
              </Text>
            </View>
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>{req.category.replace('_', ' ')}</Text>
            {req.flat && <Text style={styles.metaText}>· Flat {req.flat.unitNumber}</Text>}
            {req.resident && <Text style={styles.metaText}>· {req.resident.firstName} {req.resident.lastName}</Text>}
          </View>
          {req.adminNotes && (
            <Text style={styles.adminNotePreview} numberOfLines={1}>📝 {req.adminNotes}</Text>
          )}
        </View>
      </View>
      {req.status !== 'CLOSED' && (
        <TouchableOpacity style={styles.updateBtn} onPress={() => onUpdate(req)}>
          <Ionicons name="create-outline" size={14} color={colors.primary} />
          <Text style={styles.updateBtnText}>Update</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function AdminHelpdeskScreen() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [updating, setUpdating] = useState<MaintenanceRequest | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['helpdesk-admin', filterStatus],
    queryFn: () => helpdeskApi.list({ status: filterStatus || undefined, limit: 100 }),
  });

  const requests: MaintenanceRequest[] = data?.data ?? [];
  const open = requests.filter(r => r.status === 'OPEN').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Helpdesk" />

      {/* Summary + filter */}
      <View style={styles.filterBar}>
        <View style={styles.summary}>
          <Text style={styles.summaryText}>{open} open</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          {['', ...STATUS_OPTIONS].map(s => (
            <TouchableOpacity
              key={s || 'all'}
              style={[styles.filterChip, filterStatus === s && styles.filterChipActive]}
              onPress={() => setFilterStatus(s)}
            >
              <Text style={[styles.filterChipText, filterStatus === s && styles.filterChipTextActive]}>
                {s ? s.replace('_', ' ') : 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {updating && <UpdateModal request={updating} onClose={() => setUpdating(null)} />}

      {isLoading ? (
        <LoadingState />
      ) : requests.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No requests"
          description={filterStatus ? `No ${filterStatus.replace('_', ' ').toLowerCase()} requests` : 'No maintenance requests yet'}
        />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item }) => <RequestCard req={item} onUpdate={setUpdating} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.sm, paddingBottom: spacing['4xl'] },

  filterBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  summary: { backgroundColor: colors.warningLight ?? '#fffbeb', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  summaryText: { ...typography.labelSmall, color: colors.warning },
  filterScroll: { flex: 1 },
  filterContent: { gap: spacing.sm },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterChipText: { ...typography.labelSmall, color: colors.textSecondary },
  filterChipTextActive: { color: colors.primary },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  cardTop: { flexDirection: 'row' },
  priorityBar: { width: 4, flexShrink: 0 },
  cardMain: { flex: 1, padding: spacing.md, gap: spacing.xs },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { ...typography.labelLarge, color: colors.text, flex: 1 },
  statusPill: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, flexShrink: 0 },
  statusPillText: { ...typography.labelSmall },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  metaText: { ...typography.bodySmall, color: colors.textSecondary },
  adminNotePreview: { ...typography.bodySmall, color: colors.primary, fontStyle: 'italic' },
  updateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: spacing.sm, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  updateBtnText: { ...typography.labelSmall, color: colors.primary },

  // Modal
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { ...typography.headingSmall, color: colors.text, flex: 1, marginRight: spacing.sm },
  modalScroll: { flex: 1 },
  modalContent: { padding: spacing.base, gap: spacing.base, paddingBottom: spacing['4xl'] },

  descBox: { backgroundColor: colors.surfaceSecondary ?? colors.background, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  descLabel: { ...typography.labelSmall, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  descText: { ...typography.body, color: colors.text },

  fieldLabel: { ...typography.labelLarge, color: colors.text },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  statusChipText: { ...typography.labelMedium, color: colors.textSecondary },

  notesHint: { ...typography.bodySmall, color: colors.textTertiary, marginBottom: spacing.xs },
  textArea: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, minHeight: 80,
    ...typography.body, color: colors.text, backgroundColor: colors.surface,
  },
});
