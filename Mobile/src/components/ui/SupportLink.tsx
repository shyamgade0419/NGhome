import React from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { supportApi } from '@/api/endpoints/support.api';
import { buildUpiUri } from '@/utils/upi';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography } from '@/theme';

/**
 * A small, optional "buy me a coffee" row — deliberately not a banner. Shown
 * only when the platform admin has switched it on with a UPI ID. Tapping it
 * opens the user's UPI app with no amount set; if there is no UPI app, the ID
 * is offered to copy instead. Nothing here ever blocks the app.
 */
export function SupportLink() {
  const { data } = useQuery({
    queryKey: ['support-info'],
    queryFn: supportApi.info,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const support = data?.support;
  if (!support) return null;

  const showId = () =>
    Alert.alert('Support NG Home', `No UPI app was found. You can pay to this UPI ID from any UPI app:\n\n${support.upiId}`, [
      { text: 'Close', style: 'cancel' },
      {
        text: 'Copy UPI ID',
        onPress: () => {
          void Clipboard.setStringAsync(support.upiId);
        },
      },
    ]);

  const open = async () => {
    try {
      await Linking.openURL(buildUpiUri(support.upiId, support.payeeName));
    } catch {
      showId();
    }
  };

  return (
    <Card onPress={open} style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="cafe-outline" size={20} color={colors.primary} />
        <View style={styles.text}>
          <Text style={styles.title}>Support NG Home</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {support.message}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1 },
  title: { ...typography.labelLarge, color: colors.text },
  sub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
});
