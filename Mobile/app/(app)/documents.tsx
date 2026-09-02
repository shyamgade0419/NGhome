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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { documentsApi, SocietyDocument } from '@/api/endpoints/documents.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography, radius } from '@/theme';

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
      <ScreenHeader title="Documents" showBack />

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
