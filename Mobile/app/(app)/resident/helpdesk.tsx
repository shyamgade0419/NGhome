import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Modal, TextInput, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { helpdeskApi, MaintenanceRequest } from '@/api/endpoints/helpdesk.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

const CATEGORIES = [
  { value: 'PLUMBING', label: '🔧 Plumbing' },
  { value: 'ELECTRICAL', label: '⚡ Electrical' },
  { value: 'CIVIL', label: '🏗️ Civil' },
  { value: 'CLEANING', label: '🧹 Cleaning' },
  { value: 'SECURITY', label: '🔒 Security' },
  { value: 'ELEVATOR', label: '🛗 Elevator' },
  { value: 'CARPENTRY', label: '🪚 Carpentry' },
  { value: 'PEST_CONTROL', label: '🐛 Pest Control' },
  { value: 'OTHER', label: '📋 Other' },
];

const PRIORITIES = [
  { value: 'LOW', label: 'Low', color: colors.textSecondary },
  { value: 'MEDIUM', label: 'Medium', color: colors.info },
  { value: 'HIGH', label: 'High', color: colors.warning },
  { value: 'URGENT', label: 'Urgent', color: colors.error },
];

const STATUS_COLOR: Record<string, string> = {
  OPEN: colors.warning,
  IN_PROGRESS: colors.info,
  RESOLVED: colors.success,
  CLOSED: colors.textTertiary,
};

function NewRequestModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [priority, setPriority] = useState('MEDIUM');

  const mutation = useMutation({
    mutationFn: () => helpdeskApi.create({ title: title.trim(), description: description.trim() || undefined, category, priority }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helpdesk-mine'] });
      Alert.alert('Submitted', 'Your request has been submitted. The admin team will respond shortly.');
      setTitle(''); setDescription(''); setCategory('OTHER'); setPriority('MEDIUM');
      onClose();
    },
    onError: () => Alert.alert('Error', 'Failed to submit request. Please try again.'),
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Maintenance Request</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Issue Title *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Leaking tap in bathroom"
            placeholderTextColor={colors.textTertiary}
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chipWrap}>
            {CATEGORIES.map(c => (
              <TouchableOpacity
                key={c.value}
                style={[styles.chip, category === c.value && styles.chipActive]}
                onPress={() => setCategory(c.value)}
              >
                <Text style={[styles.chipText, category === c.value && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map(p => (
              <TouchableOpacity
                key={p.value}
                style={[styles.priorityChip, priority === p.value && { borderColor: p.color, backgroundColor: p.color + '18' }]}
                onPress={() => setPriority(p.value)}
              >
                <Text style={[styles.priorityText, priority === p.value && { color: p.color }]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the issue, include exact location…"
            placeholderTextColor={colors.textTertiary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <Button
            label="Submit Request"
            onPress={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!title.trim()}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function RequestCard({ req }: { req: MaintenanceRequest }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = STATUS_COLOR[req.status] ?? colors.textSecondary;

  return (
    <TouchableOpacity style={styles.card} onPress={() => setExpanded(v => !v)} activeOpacity={0.85}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>{req.title}</Text>
            <Text style={styles.cardMeta}>{req.category.replace('_', ' ')} · {new Date(req.createdAt).toLocaleDateString('en-IN')}</Text>
          </View>
        </View>
        <View style={[styles.statusPill, { borderColor: statusColor }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{req.status.replace('_', ' ')}</Text>
        </View>
      </View>

      {expanded && (
        <View style={styles.cardBody}>
          {req.description && <Text style={styles.cardDesc}>{req.description}</Text>}
          {req.adminNotes && (
            <View style={styles.adminNote}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.primary} />
              <Text style={styles.adminNoteText}>{req.adminNotes}</Text>
            </View>
          )}
          {req.resolvedAt && (
            <Text style={styles.resolvedText}>✅ Resolved on {new Date(req.resolvedAt).toLocaleDateString('en-IN')}</Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ResidentHelpdeskScreen() {
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['helpdesk-mine'],
    queryFn: () => helpdeskApi.list({ limit: 50 }),
  });

  const requests: MaintenanceRequest[] = data?.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Helpdesk"
        rightAction={
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowNew(true)} hitSlop={8}>
            <Ionicons name="add" size={22} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <NewRequestModal visible={showNew} onClose={() => setShowNew(false)} />

      {isLoading ? (
        <LoadingState />
      ) : requests.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No requests yet"
          description="Tap + to raise a maintenance request"
          actionLabel="New Request"
          onAction={() => setShowNew(true)}
        />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item }) => <RequestCard req={item} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.sm, paddingBottom: spacing['4xl'] },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  cardTitle: { ...typography.labelLarge, color: colors.text },
  cardMeta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  statusPill: {
    borderWidth: 1, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, flexShrink: 0,
  },
  statusText: { ...typography.labelSmall },
  cardBody: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs },
  cardDesc: { ...typography.bodySmall, color: colors.textSecondary },
  adminNote: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radius.sm, padding: spacing.sm },
  adminNoteText: { ...typography.bodySmall, color: colors.primary, flex: 1 },
  resolvedText: { ...typography.bodySmall, color: colors.success },

  addBtn: { padding: spacing.xs },

  // Modal
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalScroll: { flex: 1 },
  modalContent: { padding: spacing.base, gap: spacing.base, paddingBottom: spacing['4xl'] },

  fieldLabel: { ...typography.labelLarge, color: colors.text, marginBottom: -spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, ...typography.body, color: colors.text, backgroundColor: colors.surface,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.primary },

  priorityRow: { flexDirection: 'row', gap: spacing.sm },
  priorityChip: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  priorityText: { ...typography.labelMedium, color: colors.textSecondary },
});
