import React from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { inr } from '@/utils/format';
import { BillReminder, whatsappUrl } from '@/utils/reminders';

/** Open WhatsApp on a ready-made message. Falls back to the share sheet-free wa.me page if the app cannot be reached. */
export async function openWhatsApp(reminder: Pick<BillReminder, 'message' | 'residentPhone'>) {
  try {
    await Linking.openURL(whatsappUrl(reminder.message, reminder.residentPhone));
  } catch {
    Alert.alert('WhatsApp', 'WhatsApp could not be opened on this phone.');
  }
}

/**
 * Every unpaid flat of a period, who a reminder goes to (the tenant when the flat has one, otherwise the owner), and
 * a one-tap WhatsApp message worded from the society's template. "Notify all in the app" sends a notification with
 * a sound to every one of them at once.
 */
export function RemindAllModal({ periodId, onClose }: { periodId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['billing-period-reminders', periodId],
    queryFn: () => billingApi.getReminders(periodId),
  });
  const list = data ?? [];

  const notifyAll = useMutation({
    mutationFn: () => billingApi.sendReminders(periodId),
    onSuccess: (r) =>
      Alert.alert(
        'Reminders sent',
        `Sent to ${r.sent} of ${r.unpaid} unpaid flat${r.unpaid === 1 ? '' : 's'}.` +
          (r.withoutResident.length ? `\n\nNo resident registered yet in: ${r.withoutResident.join(', ')}.` : ''),
      ),
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Could not send the reminders.'),
  });

  const confirmNotify = () =>
    Alert.alert('Notify all unpaid flats', `Send a reminder notification to ${list.length} flat${list.length === 1 ? '' : 's'} now?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => notifyAll.mutate() },
    ]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Remind unpaid flats</Text>
            <Text style={s.meta}>
              {list.length} unpaid · {list.filter((r) => !!r.residentPhone).length} with a saved number · goes to the tenant, else the owner
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(r) => r.billId}
            ListHeaderComponent={
              list.length > 0 ? (
                <View style={s.notifyBox}>
                  <Button label={`Notify all ${list.length} in the app`} onPress={confirmNotify} loading={notifyAll.isPending} fullWidth />
                  <Text style={s.hint}>Sends a notification, with a sound, to every unpaid flat at once. For WhatsApp, tap Send on each row.</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={<Text style={s.empty}>Every flat has paid. Nothing to remind.</Text>}
            renderItem={({ item }) => (
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.flat}>{item.flatCode}</Text>
                  {item.residentName ? (
                    <Text style={s.who} numberOfLines={1}>
                      {item.residentName} · {item.residentType === 'TENANT' ? 'Tenant' : 'Owner'}
                    </Text>
                  ) : (
                    <Text style={s.warn}>No resident registered</Text>
                  )}
                  {item.residentPhone ? <Text style={s.phone}>{item.residentPhone}</Text> : null}
                </View>
                <Text style={s.amount}>{inr(item.pendingAmount)}</Text>
                <TouchableOpacity
                  style={[s.wa, !item.residentPhone && s.waNoNumber]}
                  onPress={() => openWhatsApp(item)}
                  accessibilityLabel={`WhatsApp Flat ${item.flatCode}`}
                >
                  <Ionicons name="logo-whatsapp" size={16} color="#128C5E" />
                  <Text style={s.waText}>{item.residentPhone ? 'Send' : 'Pick contact'}</Text>
                </TouchableOpacity>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={s.sep} />}
            ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  title: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notifyBox: { padding: spacing.base, gap: spacing.sm },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  empty: { ...typography.bodyMedium, color: colors.textSecondary, textAlign: 'center', padding: spacing['2xl'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.md, backgroundColor: colors.surface },
  sep: { height: 1, backgroundColor: colors.borderLight },
  flat: { ...typography.labelLarge, color: colors.text },
  who: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },
  warn: { ...typography.bodySmall, color: colors.warning, marginTop: 1 },
  phone: { ...typography.bodySmall, color: '#128C5E', marginTop: 1 },
  amount: { ...typography.labelLarge, color: colors.warning },
  wa: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.secondaryLight, borderWidth: 1, borderColor: '#25D366',
  },
  waNoNumber: { borderColor: colors.border },
  waText: { ...typography.labelMedium, color: '#128C5E' },
});
