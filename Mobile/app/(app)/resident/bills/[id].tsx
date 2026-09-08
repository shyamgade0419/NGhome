import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Share,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography, radius } from '@/theme';
import { inr } from '@/utils/format';

function InfoRow({ label, value, valueStyle }: { label: string; value: string; valueStyle?: any }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={[infoStyles.value, valueStyle]}>{value}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  label: { ...typography.bodyMedium, color: colors.textSecondary, flex: 1 },
  value: { ...typography.bodyMedium, color: colors.text, flex: 1.2, textAlign: 'right', fontWeight: '600' },
});

export default function ResidentBillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: bill, isLoading } = useQuery({
    queryKey: ['my-bill-detail', id],
    queryFn: () => billingApi.getBill(id),
    enabled: !!id,
  });

  const handleShare = async () => {
    if (!bill) return;
    const pending = parseFloat(bill.pendingAmount ?? '0');
    const water = parseFloat(bill.waterCharges ?? '0');
    const lines = [
      `🏢 Maintenance Bill — ${bill.invoiceNumber}`,
      `Flat: ${bill.flatCode ?? ''}`,
      `Total: ${inr(bill.totalAmount)}`,
      ...(water > 0 ? [`   • Maintenance: ₹${parseFloat(bill.baseAmount ?? '0').toLocaleString('en-IN')}`, `   • Water: ₹${water.toLocaleString('en-IN')}`] : []),
      `Status: ${bill.isPaid ? '✅ PAID' : `⚠️ Due ₹${pending.toLocaleString('en-IN')}`}`,
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  if (isLoading) return <LoadingState fullscreen message="Loading bill…" />;
  if (!bill) return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bill Detail" showBack />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
        <Ionicons name="receipt-outline" size={48} color={colors.textDisabled} />
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>Bill not found</Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>This bill may have been removed, or you don&apos;t have access to it.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 8, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const total = parseFloat(bill.totalAmount ?? '0');
  const paid = parseFloat(bill.paidAmount ?? '0');
  const pending = parseFloat(bill.pendingAmount ?? '0');
  const base = parseFloat(bill.baseAmount ?? '0');
  const water = parseFloat(bill.waterCharges ?? '0');
  const adjustments = parseFloat(bill.adjustments ?? '0');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Bill Detail"
        showBack
        rightAction={
          <TouchableOpacity onPress={handleShare} hitSlop={8} style={styles.shareBtn}>
            <Ionicons name="share-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Hero card */}
        <View style={[styles.heroCard, bill.isPaid ? styles.heroPaid : styles.heroPending]}>
          <View style={styles.heroTop}>
            <Text style={styles.heroInvoice}>{bill.invoiceNumber}</Text>
            <StatusBadge
              label={bill.isPaid ? 'PAID' : 'PENDING'}
              variant={bill.isPaid ? 'success' : 'warning'}
            />
          </View>
          <Text style={styles.heroAmount}>₹{total.toLocaleString('en-IN')}</Text>
          {!bill.isPaid && pending > 0 && (
            <Text style={styles.heroSub}>
              ₹{pending.toLocaleString('en-IN')} outstanding
              {bill.dueDate
                ? ` · Due ${new Date(bill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : ''}
            </Text>
          )}
          {bill.isPaid && (
            <Text style={styles.heroSub}>Paid in full — Thank you!</Text>
          )}
        </View>

        {/* Charge breakdown */}
        <Card style={styles.section} padding="md">
          <Text style={styles.sectionTitle}>Charge Breakdown</Text>

          <InfoRow label="Maintenance" value={`₹${base.toLocaleString('en-IN')}`} />
          {water > 0 && (
            <InfoRow
              label="Water Charges"
              value={`₹${water.toLocaleString('en-IN')}`}
              valueStyle={{ color: colors.info }}
            />
          )}
          {adjustments !== 0 && (
            <InfoRow
              label="Adjustments"
              value={`${adjustments > 0 ? '+' : ''}₹${adjustments.toLocaleString('en-IN')}`}
              valueStyle={{ color: adjustments < 0 ? colors.secondary : colors.error }}
            />
          )}
          <View style={[infoStyles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total Due</Text>
            <Text style={styles.totalValue}>₹{total.toLocaleString('en-IN')}</Text>
          </View>
        </Card>

        {/* Payment summary */}
        <Card style={styles.section} padding="md">
          <Text style={styles.sectionTitle}>Payment Summary</Text>
          <InfoRow label="Total Billed" value={`₹${total.toLocaleString('en-IN')}`} />
          <InfoRow
            label="Amount Paid"
            value={`₹${paid.toLocaleString('en-IN')}`}
            valueStyle={{ color: colors.secondary }}
          />
          <InfoRow
            label="Balance Due"
            value={`₹${pending.toLocaleString('en-IN')}`}
            valueStyle={{ color: pending > 0 ? colors.warning : colors.secondary }}
          />
        </Card>

        {/* Line items (if present) */}
        {(bill as any).lineItems?.length > 0 && (
          <Card style={styles.section} padding="md">
            <Text style={styles.sectionTitle}>Bill Items</Text>
            {(bill as any).lineItems.map((item: any) => (
              <InfoRow
                key={item.id}
                label={item.description ?? item.name ?? item.type ?? 'Item'}
                value={inr(item.amount)}
              />
            ))}
          </Card>
        )}

        {/* Bill info */}
        <Card style={styles.section} padding="md">
          <Text style={styles.sectionTitle}>Bill Information</Text>
          <InfoRow label="Invoice #" value={bill.invoiceNumber ?? '—'} />
          {bill.flatCode && <InfoRow label="Flat" value={bill.flatCode} />}
          {bill.dueDate && (
            <InfoRow
              label="Due Date"
              value={new Date(bill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            />
          )}
        </Card>

        {/* Action */}
        {!bill.isPaid && pending > 0 && (
          <Button
            label="Submit Payment"
            onPress={() => router.push('/(app)/resident/payments/submit' as any)}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.md }}
          />
        )}

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md },
  shareBtn: { padding: 4 },

  heroCard: {
    borderRadius: 20,
    padding: spacing.xl,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  heroPaid: { backgroundColor: '#059669' },
  heroPending: { backgroundColor: colors.primary },

  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroInvoice: { ...typography.labelLarge, color: 'rgba(255,255,255,0.8)' },
  heroAmount: { ...typography.displayLarge, color: '#FFFFFF' },
  heroSub: { ...typography.bodySmall, color: 'rgba(255,255,255,0.75)' },

  section: {},
  sectionTitle: { ...typography.headingSmall, color: colors.text, marginBottom: spacing.sm },

  totalRow: {
    borderBottomWidth: 0,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  totalLabel: { ...typography.labelLarge, color: colors.text, flex: 1, fontWeight: '700' },
  totalValue: { ...typography.headingMedium, color: colors.text, fontWeight: '700' },
});
