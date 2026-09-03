/**
 * Documents — shared by admins and residents, now with two scopes.
 *
 * "Society" is the original list: the API scopes rows by accessLevel for
 * the calling role, admin/staff post official documents by pasting a link
 * (there's still no upload path for that flow — matches web exactly).
 *
 * "My Flat" is new: FLAT_PRIVATE documents, a real file upload backed by
 * the society's SFTP server. Visible to any active resident of that exact
 * flat (a membership's flatId, not a specific person) and invisible to
 * everyone else including admin — the backend enforces this, this screen
 * just has to not assume otherwise. Only shown when the signed-in
 * membership actually has a flatId, since that's what an upload gets
 * scoped to; a pure admin with no flat of their own has nothing to put here.
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
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
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
 * Admin's paste-a-link flow — no file storage involved, matches web's own
 * "Add Document" form exactly (plain text fields referencing a file
 * already hosted elsewhere).
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

/**
 * Resident's real file upload — private to their own flat. accessLevel and
 * flatId are deliberately not offered here: the backend forces FLAT_PRIVATE
 * on the caller's own flatId server-side regardless of what's sent, so
 * there is nothing for this form to get wrong.
 */
function UploadFlatDocumentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [file, setFile] = useState<{ uri: string; name: string; mimeType?: string | null; size?: number } | null>(null);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size ?? undefined });
    if (!title.trim()) {
      // Pre-fill a sensible title from the filename, still fully editable.
      setTitle(asset.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a file first.');
      return documentsApi.upload(file, {
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      Alert.alert('Uploaded', 'Only you and others on your flat can see this.');
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to upload document.'),
  });

  const canSubmit = !!file && title.trim().length > 0;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.safe} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <Text style={modal.title}>Upload Flat Document</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={modal.content} keyboardShouldPersistTaps="handled">
            <View style={modal.privacyNote}>
              <Ionicons name="lock-closed" size={13} color={colors.primary} />
              <Text style={modal.privacyNoteText}>
                Private to your flat — visible to residents there, not to admin or any other flat.
              </Text>
            </View>

            <Text style={modal.label}>File *</Text>
            <TouchableOpacity style={modal.filePicker} onPress={pickFile} activeOpacity={0.7}>
              <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
              <Text style={modal.filePickerText} numberOfLines={1}>
                {file ? file.name : 'Choose a file — PDF, image, or document'}
              </Text>
            </TouchableOpacity>

            <Text style={modal.label}>Title *</Text>
            <TextInput
              style={modal.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Property Tax Receipt 2026"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={modal.label}>Description</Text>
            <TextInput
              style={[modal.input, modal.textarea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Optional"
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <Text style={modal.label}>Category</Text>
            <TextInput
              style={modal.input}
              value={category}
              onChangeText={setCategory}
              placeholder="e.g. Tax, Insurance, Agreement"
              placeholderTextColor={colors.textTertiary}
            />

            <Button
              label={mutation.isPending ? 'Uploading…' : 'Upload'}
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

// ── Row ──────────────────────────────────────────────────────────────────────

function DocumentRow({ doc, onDeleted }: { doc: SocietyDocument; onDeleted?: () => void }) {
  const tint = tintFor(doc.mimeType);
  const [opening, setOpening] = useState(false);
  const isUpload = doc.storageProvider === 'sftp';
  const isPrivate = doc.accessLevel === 'FLAT_PRIVATE';

  const deleteMutation = useMutation({
    mutationFn: () => documentsApi.remove(doc.id),
    onSuccess: () => onDeleted?.(),
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to delete document.'),
  });

  const handleOpen = async () => {
    if (isUpload) {
      setOpening(true);
      try {
        await documentsApi.openFile(doc.id, doc.fileName);
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Failed to open document.');
      } finally {
        setOpening(false);
      }
      return;
    }
    // Link-based (admin paste-a-link) document — fileKey is the URL itself.
    Alert.alert(
      doc.title,
      [doc.description, `File: ${doc.fileName}`, doc.category ? `Category: ${doc.category}` : null]
        .filter(Boolean)
        .join('\n'),
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Open Link', onPress: () => Linking.openURL(doc.fileKey).catch(() => {
          Alert.alert('Error', 'This link could not be opened.');
        }) },
      ],
    );
  };

  const handleDelete = () => {
    Alert.alert('Delete Document', `Remove "${doc.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  };

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={handleOpen} disabled={opening}>
      <View style={[styles.iconWrap, { backgroundColor: tint + '18' }]}>
        {opening ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name={iconFor(doc.mimeType)} size={20} color={tint} />}
      </View>

      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{doc.title}</Text>
          {isPrivate && <Ionicons name="lock-closed" size={12} color={colors.textTertiary} />}
        </View>
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
        {doc.uploadedBy ? (
          <Text style={styles.uploader}>By {doc.uploadedBy.firstName} {doc.uploadedBy.lastName}</Text>
        ) : null}
      </View>

      {isPrivate ? (
        <TouchableOpacity onPress={handleDelete} hitSlop={8} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

type Tab = 'society' | 'flat';

export default function DocumentsScreen() {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [tab, setTab] = useState<Tab>('society');
  const { user } = useAuth();
  const isAdmin = user?.currentRole === 'SOCIETY_ADMIN' || user?.currentRole === 'SOCIETY_STAFF';
  const hasFlat = !!user?.flatId;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['documents'],
    queryFn: () => documentsApi.list(),
  });

  const allDocs: SocietyDocument[] = useMemo(() => data?.data ?? [], [data]);
  const societyDocs = useMemo(() => allDocs.filter((d) => d.accessLevel !== 'FLAT_PRIVATE'), [allDocs]);
  const flatDocs = useMemo(() => allDocs.filter((d) => d.accessLevel === 'FLAT_PRIVATE'), [allDocs]);
  const docs = tab === 'flat' ? flatDocs : societyDocs;

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
          tab === 'flat' ? (
            hasFlat ? (
              <TouchableOpacity onPress={() => setShowUpload(true)} hitSlop={8}>
                <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            ) : undefined
          ) : isAdmin ? (
            <TouchableOpacity onPress={() => setShowAdd(true)} hitSlop={8}>
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* Society / My Flat tabs — only worth showing if there's a flat to scope to */}
      {hasFlat && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === 'society' && styles.tabActive]}
            onPress={() => { setTab('society'); setCategory(null); }}
          >
            <Text style={[styles.tabText, tab === 'society' && styles.tabTextActive]}>Society</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'flat' && styles.tabActive]}
            onPress={() => { setTab('flat'); setCategory(null); }}
          >
            <Text style={[styles.tabText, tab === 'flat' && styles.tabTextActive]}>
              My Flat{flatDocs.length > 0 ? ` (${flatDocs.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchBar}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder={tab === 'flat' ? 'Search your flat documents…' : 'Search documents…'}
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
          renderItem={({ item }) => <DocumentRow doc={item} onDeleted={refetch} />}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            tab === 'flat' ? (
              <EmptyState
                icon="lock-closed-outline"
                title={search || category ? 'No matching documents' : 'No flat documents yet'}
                description={
                  search || category
                    ? 'Try a different search or category.'
                    : "Upload your own — tax receipts, agreements, anything you'd like kept with your flat's records. Only residents here can see them."
                }
              />
            ) : (
              <EmptyState
                icon="folder-open-outline"
                title={search || category ? 'No matching documents' : 'No documents yet'}
                description={
                  search || category
                    ? 'Try a different search or category.'
                    : 'Society bye-laws, circulars and notices will appear here.'
                }
              />
            )
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {showAdd && <AddDocumentModal onClose={() => setShowAdd(false)} />}
      {showUpload && <UploadFlatDocumentModal onClose={() => setShowUpload(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { ...typography.labelMedium, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '700' },

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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { ...typography.labelLarge, color: colors.text, fontWeight: '600', flexShrink: 1 },
  desc: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' },
  meta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11 },
  metaDot: { color: colors.textTertiary, fontSize: 11 },
  uploader: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  deleteBtn: { padding: spacing.xs },
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

  privacyNote: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'center',
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.xs,
  },
  privacyNoteText: { ...typography.bodySmall, color: colors.primary, flex: 1, lineHeight: 16 },
  filePicker: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed',
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  filePickerText: { ...typography.bodyMedium, color: colors.text, flex: 1 },
});
