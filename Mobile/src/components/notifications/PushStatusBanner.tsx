import React from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/api/endpoints/notifications.api';
import { getPushStatus, registerForPushNotificationsAsync } from '@/notifications/push';
import { colors, radius, spacing, typography } from '@/theme';

/**
 * Says whether this phone will get alerts, and why not when it will not. Registration for phone alerts used to fail
 * without a word, so "I get no notifications" had no answer; now the screen where notifications live shows it, and
 * a test button proves the whole path (phone, push service, sound) in one tap.
 */
export function PushStatusBanner() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({ queryKey: ['push-status'], queryFn: getPushStatus, refetchInterval: false });

  const retry = useMutation({
    mutationFn: registerForPushNotificationsAsync,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['push-status'] }),
  });

  const test = useMutation({
    mutationFn: notificationsApi.pushTest,
    onSuccess: (r) => {
      if (r.devices === 0) {
        Alert.alert('No phone registered', 'This phone is not registered for alerts yet. Tap "Try again", then test once more.');
      } else if (r.accepted > 0 && r.problems.length === 0) {
        Alert.alert('Test sent', 'You should see and hear an alert in a few seconds. If you do not, check the phone is not on silent or Do Not Disturb.');
      } else {
        Alert.alert('The alert could not be delivered', r.problems.join('\n') || 'The push service did not accept it.');
      }
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Could not send the test alert.'),
  });

  // Nothing until it is known: a warning that flashes while the answer loads would cry wolf.
  if (isLoading) return null;

  if (status?.state === 'ready') {
    return (
      <View style={[s.box, s.ok]}>
        <Ionicons name="notifications" size={18} color="#166534" />
        <Text style={[s.text, { color: '#166534' }]}>Phone alerts are on for this phone.</Text>
        <TouchableOpacity onPress={() => test.mutate()} disabled={test.isPending} accessibilityLabel="Send a test alert">
          <Text style={s.action}>{test.isPending ? 'Sending…' : 'Send a test'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const denied = status?.state === 'denied';
  return (
    <View style={[s.box, s.warn]}>
      <Ionicons name="notifications-off-outline" size={18} color="#92400E" />
      <View style={{ flex: 1 }}>
        <Text style={[s.text, { color: '#92400E', fontWeight: '600' }]}>This phone will not get alerts yet</Text>
        <Text style={[s.text, { color: '#92400E' }]}>
          {status?.detail ?? 'Alerts have not been set up on this phone.'}
        </Text>
      </View>
      {denied ? (
        <TouchableOpacity onPress={() => Linking.openSettings()} accessibilityLabel="Open phone settings">
          <Text style={s.action}>Open settings</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => retry.mutate()} disabled={retry.isPending} accessibilityLabel="Try again">
          <Text style={s.action}>{retry.isPending ? 'Trying…' : 'Try again'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.base, marginBottom: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1,
  },
  ok: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  warn: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  text: { ...typography.bodySmall, flexShrink: 1 },
  action: { ...typography.labelMedium, color: colors.primary, textDecorationLine: 'underline' },
});
