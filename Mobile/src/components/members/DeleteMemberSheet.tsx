import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { membersApi } from '@/api/endpoints/members.api';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing, typography } from '@/theme';

export interface MemberToDelete {
  userId: string;
  name: string;
  email: string;
}

/** The typed email must match the account's, ignoring case and stray spaces. */
export function confirmationMatches(typed: string, email: string): boolean {
  return email.trim() !== '' && typed.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * Permanently deletes a member's account. "Remove" only ends the membership and
 * leaves the account, so their email and phone stay taken and they can never be
 * added again; this erases the account itself.
 *
 * The server says first what would go and what stops it, and checks the typed
 * email again before it deletes. Drawn as an in-tree sheet, not a native Modal.
 */
export function DeleteMemberSheet({ member, onClose }: { member: MemberToDelete | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');

  useEffect(() => setTyped(''), [member?.userId]);

  const previewQ = useQuery({
    queryKey: ['member-deletion-preview', member?.userId],
    queryFn: () => membersApi.deletionPreview(member!.userId),
    enabled: !!member,
    staleTime: 0,
    gcTime: 0,
  });
  const preview = previewQ.data;

  const erase = useMutation({
    mutationFn: () => membersApi.deleteMember(member!.userId, typed.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-members-mobile'] });
      qc.invalidateQueries({ queryKey: ['removed-members-mobile'] });
      onClose();
    },
  });

  const close = () => {
    if (!erase.isPending) onClose();
  };
  const matches = !!preview && confirmationMatches(typed, preview.user.email);
  const serverMessage = (erase.error as any)?.response?.data?.message;

  return (
    <InlineSheet visible={!!member} onRequestClose={close}>
      {member && (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>Delete account permanently</Text>
            <TouchableOpacity onPress={close} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View>
            <Text style={styles.name}>{member.name}</Text>
            <Text style={styles.sub}>{member.email}</Text>
          </View>

          {previewQ.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : previewQ.isError || !preview ? (
            <Text style={styles.errorText}>Couldn&apos;t check this account. Close this and try again.</Text>
          ) : (
            <>
              {preview.reasons.length > 0 && (
                <View style={styles.redBox}>
                  {preview.reasons.map((r) => (
                    <Text key={r} style={styles.redText}>{r}</Text>
                  ))}
                </View>
              )}

              {preview.blockedBy.length > 0 && (
                <View style={styles.amberBox}>
                  <Text style={styles.amberTitle}>The society still has records from this person:</Text>
                  {preview.blockedBy.map((b) => (
                    <Text key={b.label} style={styles.amberText}>• {b.label}: {b.count}</Text>
                  ))}
                  <Text style={styles.amberNote}>
                    Those are part of the society&apos;s history (payments, notices and so on), so the account is kept.
                    Use Remove instead, which ends their access but keeps those records.
                  </Text>
                </View>
              )}

              {preview.canDelete && (
                <>
                  <Text style={styles.body}>
                    This erases the account for good. They can no longer sign in, and their email and phone can be used
                    for a new sign-up.{preview.willRemove.length > 0 ? ' It also removes:' : ''}
                  </Text>
                  {preview.willRemove.map((w) => (
                    <Text key={w.label} style={styles.bullet}>• {w.label}: {w.count}</Text>
                  ))}

                  <Text style={styles.label}>
                    Type <Text style={styles.mono}>{preview.user.email}</Text> to confirm
                  </Text>
                  <TextInput
                    value={typed}
                    onChangeText={setTyped}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    accessibilityLabel="Type the email to confirm"
                    style={styles.input}
                  />
                  {!!serverMessage && <Text style={styles.errorText}>{String(serverMessage)}</Text>}
                  {erase.isError && !serverMessage && (
                    <Text style={styles.errorText}>Could not delete the account — nothing was deleted.</Text>
                  )}
                </>
              )}
            </>
          )}

          <View style={styles.actions}>
            <Button
              label={preview && !preview.canDelete ? 'Close' : 'Cancel'}
              variant="outline"
              onPress={close}
              disabled={erase.isPending}
              style={{ flex: 1 }}
            />
            {preview?.canDelete && (
              <Button
                label="Delete permanently"
                variant="danger"
                onPress={() => erase.mutate()}
                loading={erase.isPending}
                disabled={!matches}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </>
      )}
    </InlineSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.headingSmall, color: colors.text },
  name: { ...typography.labelLarge, color: colors.text },
  sub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  body: { ...typography.bodyMedium, color: colors.text },
  bullet: { ...typography.bodySmall, color: colors.textSecondary, paddingLeft: spacing.sm },
  label: { ...typography.labelMedium, color: colors.text },
  mono: { fontFamily: 'monospace', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    backgroundColor: colors.background,
  },
  errorText: { ...typography.bodySmall, color: colors.error },
  redBox: { backgroundColor: '#FEE2E2', borderRadius: radius.md, padding: spacing.md, gap: 4 },
  redText: { ...typography.bodySmall, color: '#991B1B' },
  amberBox: { backgroundColor: '#FEF3C7', borderRadius: radius.md, padding: spacing.md, gap: 4 },
  amberTitle: { ...typography.labelMedium, color: '#78350F' },
  amberText: { ...typography.bodySmall, color: '#78350F' },
  amberNote: { ...typography.bodySmall, color: '#92400E', marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
