/**
 * Documents — shared by admins and residents.
 *
 * The API scopes rows by accessLevel for the calling role, so both roles use
 * the same screen and simply see different sets. Files open in the device
 * browser rather than downloading in-app: the backend stores a fileKey with a
 * pluggable storage provider, and there is no download endpoint to stream from
 * yet, so we surface metadata and let the platform handle the fetch.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsApi, SocietyDocument, DocumentAccessLevel } from '@/api/endpoints/documents.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { colors, spacing, typography, radius } from '@/theme';

const ACCESS_LEVELS: Array<{ value: DocumentAccessLevel; label: string }> = [
  { value: 'PUBLIC', label: 'Everyone' },
  { value: 'RESIDENTS_ONLY', label: 'Residents' },
  { value: 'COMMITTEE_ONLY', label: 'Committee' },
  { value: 'ADMIN_ONLY', label: 'Admins only' },
];

/**
 * There is no upload endpoint anywhere in this product yet — web's own "Add
 * Document" form is plain text fields for the file metadata, presumably
 * referencing a file already hosted elsewhere. This mirrors that exact
 * capability rather than inventing a new upload pipeline unilaterally here.
 */
function AddDocumentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    fileName: '',
    fileKey: '',
    mimeType: 'application/pdf',
    accessLevel: 'RESIDENTS_ONLY' as DocumentAccessLevel,
  });

  const mutation = useMutation({
    mutationFn: () =>
      documentsApi.create({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category.trim() || undefined,
        fileName: form.fileName.trim(),
        fileKey: form.fileKey.trim(),
        fileSize: 0,
        mimeType: form.mimeType.trim() || 'application/octet-stream',
        accessLevel: form.accessLevel,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      Alert.alert('Added', 'Document recorded.');
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to add document.'),
  });

  const canSubmit =
    form.title.trim().length > 0 && form.fileName.trim().length > 0 && form.fileKey.trim().length > 0;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.safe} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <Text style={modal.title}>Add Document</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={modal.content} keyboardShouldPersistTaps="handled">
            <Text style={modal.label}>Title *</Text>
            <TextInput
              style={modal.input}
              value={form.title}
              onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
              placeholder="e.g. Society Bye-Laws 2026"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={modal.label}>Description</Text>
            <TextInput
              style={[modal.input, modal.textarea]}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Optional"
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <Text style={modal.label}>Category</Text>
            <TextInput
              style={modal.input}
              value={form.category}
              onChangeText={(v) => setForm((f) => ({ ...f, category: v }))}
              placeholder="e.g. Bye-Laws, Circular, Minutes"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={modal.label}>File Name *</Text>
            <TextInput
              style={modal.input}
              value={form.fileName}
              onChangeText={(v) => setForm((f) => ({ ...f, fileName: v }))}
              placeholder="bye-laws-2026.pdf"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />

            <Text style={modal.label}>File Link / Key *</Text>
            <TextInput
              style={modal.input}
              value={form.fileKey}
              onChangeText={(v) => setForm((f) => ({ ...f, fileKey: v }))}
              placeholder="URL where the file is hosted"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={modal.label}>Visible To</Text>
            <View style={modal.chipRow}>
              {ACCESS_LEVELS.map((a) => (
                <TouchableOpacity
                  key={a.value}
                  style={[modal.chip, form.accessLevel === a.value && modal.chipActive]}
                  onPress={() => setForm((f) => ({ ...f, accessLevel: a.value }))}
                >
                  <Text style={[modal.chipText, form.accessLevel === a.value && modal.chipTextActive]}>
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Button
              label={mutation.isPending ? 'Saving…' : 'Save Document'}
              onPress={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!canSubmit}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.md }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mimeType: string): keyof typeof Ionicons.glyphMap {
  if (mimeType?.includes('pdf')) return 'document-text';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.includes('sheet') || mimeType?.includes('excel')) return 'grid';
  if (mimeType?.includes('word') || mimeType?.includes('document')) return 'document';
  return 'document-attach';
}

function tintFor(mimeType: string): string {
  if (mimeType?.includes('pdf')) return colors.error;
  if (mimeType?.startsWith('image/')) return colors.info;
  if (mimeType?.includes('sheet') || mimeType?.includes('excel')) return colors.success;
  return colors.primary;
}

const ACCESS_LABEL: Record<string, string> = {
  PUBLIC: 'Everyone',
  RESIDENTS_ONLY: 'Residents',
  COMMITTEE_ONLY: 'Committee',
  ADMIN_ONLY: 'Admins',
};

// ── Row ──────────────────────────────────────────────────────────────────────

function DocumentRow({ doc }: { doc: SocietyDocument }) {
  const tint = tintFor(doc.mimeType);

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() =>
        Alert.alert(
          doc.title,
          [
            doc.description,
            `File: ${doc.fileName}`,
            `Size: ${formatSize(doc.fileSize)}`,
            doc.category ? `Category: ${doc.category}` : null,
            `Visible to: ${ACCESS_LABEL[doc.accessLevel] ?? doc.accessLevel}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }
    >
      <View style={[styles.iconWrap, { backgroundColor: tint + '18' }]}>
        <Ionicons name={iconFor(doc.mimeType)} size={20} color={tint} />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={1}>{doc.title}</Text>
        {doc.description ? (
          <Text style={styles.desc} numberOfLines={2}>{doc.description}</Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatSize(doc.fileSize)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>
            {new Date(doc.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
          {doc.category ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text style={[styles.meta, { color: tint }]}>{doc.category}</Text>
            </>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function DocumentsScreen() {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.currentRole === 'SOCIETY_ADMIN' || user?.currentRole === 'SOCIETY_STAFF';

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['documents'],
    queryFn: () => documentsApi.list(),
  });

  const docs: SocietyDocument[] = data?.data ?? [];

  const categories = useMemo(() => {
    const set = new Set(docs.map((d) => d.category).filter(Boolean) as string[]);
    return Array.from(set);
  }, [docs]);

  const [category, setCategory] = useState<string | null>(null);

  const filtered = docs.filter((d) => {
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q || d.title.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q);
    const matchCat = !category || d.category === category;
    return matchSearch && matchCat;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Documents"
        showBack
        rightAction={
          isAdmin ? (
            <TouchableOpacity onPress={() => setShowAdd(true)} hitSlop={8}>
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* Search */}
      <View style={styles.searchBar}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search documents…"
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category chips */}
      {categories.length > 0 && (
        <FlatList
          horizontal
          data={['ALL', ...categories]}
          keyExtractor={(c) => c}
          showsHorizontalScrollIndicator={false}
          style={styles.chipBar}
          contentContainerStyle={styles.chipContent}
          renderItem={({ item }) => {
            const active = item === 'ALL' ? category === null : category === item;
            return (
              <TouchableOpacity
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setCategory(item === 'ALL' ? null : item)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {isLoading ? (
        <LoadingState message="Loading documents…" />
      ) : isError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load documents"
          description="Pull down to try again."
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => <DocumentRow doc={item} />}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              title={search || category ? 'No matching documents' : 'No documents yet'}
              description={
                search || category
                  ? 'Try a different search or category.'
                  : 'Society bye-laws, circulars and notices will appear here.'
              }
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {showAdd && <AddDocumentModal onClose={() => setShowAdd(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  searchBar: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, ...typography.bodyMedium, color: colors.text, padding: 0 },

  chipBar: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  chipContent: { paddingHorizontal: spacing.base, paddingVertical: 8, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: '#fff' },

  list: { padding: spacing.base },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardBody: { flex: 1, gap: 2 },
  title: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  desc: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' },
  meta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11 },
  metaDot: { color: colors.textTertiary, fontSize: 11 },
});

const modal = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { ...typography.headingSmall, color: colors.text, fontWeight: '700' },
  content: { padding: spacing.base, gap: spacing.sm },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  textarea: { minHeight: 72, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
});
