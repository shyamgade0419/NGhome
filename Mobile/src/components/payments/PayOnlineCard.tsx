import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { onlinePaymentsApi } from '@/api/endpoints/onlinePayments.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/theme';
import { inr } from '@/utils/format';
import { cleanAmount, isOpen, outcomeMessage } from '@/utils/onlinePayments';

interface Props {
  maintenanceBillId: string;
  /** What the flat owes: the starting amount. */
  owed: string;
  /** Called once the payment is received, so the screen can refresh the bills. */
  onPaid: () => void;
}

/**
 * "Pay online": the society's own Razorpay page (UPI apps, cards, netbanking), opened in the phone's browser. The bill updates
 * by itself once Razorpay confirms the payment: the app asks the server where it stands every few seconds while it waits, and
 * straight away when the person comes back to the app. Shown only when the society has switched online payments on.
 */
export function PayOnlineCard({ maintenanceBillId, owed, onPaid }: Props) {
  const { data: available } = useQuery({ queryKey: ['online-payments-available'], queryFn: onlinePaymentsApi.available, staleTime: 60_000 });
  const [amount, setAmount] = useState(owed);
  const [starting, setStarting] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const finished = useRef(false);

  // Keep the starting amount in step with what is owed until the person changes it.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setAmount(owed);
  }, [owed]);

  const check = useCallback(async (id: string) => {
    try {
      const order = await onlinePaymentsApi.status(id);
      if (isOpen(order.outcome) || finished.current) return;
      finished.current = true;
      setOrderId(null);
      const m = outcomeMessage(order.outcome);
      if (m) Alert.alert(m.title, m.body);
      if (order.outcome === 'PAID' || order.outcome === 'NEEDS_REVIEW') onPaid();
    } catch {
      /* the next check will try again */
    }
  }, [onPaid]);

  useEffect(() => {
    if (!orderId) return;
    finished.current = false;
    const timer = setInterval(() => void check(orderId), 4000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(orderId); });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [orderId, check]);

  if (!available?.enabled) return null;

  const clean = cleanAmount(amount);

  const pay = async () => {
    if (!clean) {
      Alert.alert('Amount', 'Enter the amount you are paying.');
      return;
    }
    setStarting(true);
    try {
      const order = await onlinePaymentsApi.start({ maintenanceBillId, amount: clean });
      if (!order.url) throw new Error('No payment page was returned.');
      setOrderId(order.id);
      await Linking.openURL(order.url);
    } catch (e: any) {
      setOrderId(null);
      const m = e?.response?.data?.message;
      Alert.alert('Could not start the payment', Array.isArray(m) ? m.join(', ') : (m ?? e?.message ?? 'Please try again.'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card style={s.card}>
      <Text style={s.title}>Pay online</Text>
      {orderId ? (
        <View style={s.gap} accessibilityLiveRegion="polite">
          <Text style={s.body}>Waiting for your payment. Finish it on the Razorpay page; this screen updates by itself when it is done.</Text>
          <View style={s.row}>
            <Button label="Check now" onPress={() => void check(orderId)} variant="outline" size="sm" />
            <TouchableOpacity onPress={() => setOrderId(null)} accessibilityRole="button" accessibilityLabel="Stop waiting" hitSlop={8}>
              <Text style={s.link}>Stop waiting</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={s.gap}>
          <Input
            label="Amount (₹)"
            value={amount}
            onChangeText={(t) => { touched.current = true; setAmount(t); }}
            keyboardType="decimal-pad"
            leftIcon="cash-outline"
            accessibilityLabel="Amount to pay online"
          />
          <Button label={starting ? 'Opening…' : clean ? `Pay ${inr(clean)} online` : 'Pay online'} onPress={() => void pay()} loading={starting} fullWidth size="lg" />
          <Text style={s.hint}>UPI apps, cards or netbanking, on Razorpay&apos;s secure page. Your bill is updated as soon as it is paid.</Text>
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { gap: spacing.md, marginBottom: spacing.md },
  title: { ...typography.headingSmall, color: colors.text },
  gap: { gap: spacing.md },
  body: { ...typography.bodyMedium, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  link: { ...typography.labelMedium, color: colors.textSecondary },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
});
