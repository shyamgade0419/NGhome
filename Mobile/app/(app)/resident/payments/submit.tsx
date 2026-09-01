import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  Linking,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsApi } from '@/api/endpoints/payments.api';
import { billingApi } from '@/api/endpoints/billing.api';
import { societiesApi } from '@/api/endpoints/societies.api';
import { billingPeriodName } from '@/types/billing.types';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { colors, spacing, typography, radius } from '@/theme';

const PAYMENT_METHODS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer / NEFT / RTGS' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'OTHER', label: 'Other' },
] as const;

const schema = z.object({
  amount: z
    .string()
    .min(1, 'Amount is required')
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Enter valid amount'),
  paymentDate: z.string().min(1, 'Payment date is required'),
  paymentMethod: z.string().min(1, 'Select payment method'),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function SubmitPaymentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedMethod, setSelectedMethod] = useState<string>('UPI');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const { data: activePeriod } = useQuery({
    queryKey: ['active-period'],
    queryFn: billingApi.getCurrentPeriod,
  });

  const { data: myBill } = useQuery({
    queryKey: ['my-bill', activePeriod?.id],
    queryFn: () => billingApi.getMyBill(activePeriod!.id),
    enabled: !!activePeriod?.id,
  });

  const { data: societyConfig } = useQuery({
    queryKey: ['society-config'],
    queryFn: societiesApi.getSocietyConfig,
  });

  const upiId = (societyConfig as any)?.additionalConfig?.upiId as string | undefined;

  const submitMutation = useMutation({
    mutationFn: paymentsApi.submitPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-payments'] });
      queryClient.invalidateQueries({ queryKey: ['my-bill'] });
      Alert.alert(
        'Payment Submitted',
        'Your payment has been submitted for verification. The admin will review and approve it shortly.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    },
    onError: () => Alert.alert('Error', 'Failed to submit payment. Please try again.'),
  });

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: myBill ? myBill.pendingAmount : '',
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMethod: 'UPI',
    },
  });

  const onSubmit = (data: FormData) => {
    submitMutation.mutate({
      maintenanceBillId: myBill?.id,
      billingPeriodId: activePeriod?.id,
      amount: data.amount,
      paymentDate: data.paymentDate,
      paymentMethod: data.paymentMethod,
      referenceNumber: data.referenceNumber,
      notes: data.notes,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Submit Payment" showBack />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Bill summary */}
          {myBill && (
            <View style={styles.billSummary}>
              <Text style={styles.billPeriod}>{activePeriod ? billingPeriodName(activePeriod) : ''}</Text>
              <View style={styles.billAmounts}>
                <View style={styles.billAmountItem}>
                  <Text style={styles.billAmountLabel}>Total Bill</Text>
                  <Text style={styles.billAmountValue}>
                    ₹{parseFloat(myBill.totalAmount).toLocaleString('en-IN')}
                  </Text>
                </View>
                <View style={styles.billAmountItem}>
                  <Text style={styles.billAmountLabel}>Outstanding</Text>
                  <Text style={[styles.billAmountValue, { color: colors.warning }]}>
                    ₹{parseFloat(myBill.pendingAmount).toLocaleString('en-IN')}
                  </Text>
                </View>
              </View>
            </View>
          )}

          <Text style={styles.sectionTitle}>Payment Details</Text>

          <View style={styles.form}>
            <Controller
              control={control}
              name="amount"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Amount Paid (₹)"
                  placeholder="0.00"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.amount?.message}
                  keyboardType="decimal-pad"
                  leftIcon="cash-outline"
                  required
                />
              )}
            />

            <Controller
              control={control}
              name="paymentDate"
              render={({ field: { onChange, value } }) => (
                <View>
                  <Text style={styles.fieldLabel}>Payment Date *</Text>
                  <TouchableOpacity
                    style={styles.dateTouchable}
                    onPress={() => setShowDatePicker(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                    <Text style={styles.dateText}>
                      {value
                        ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
                        : 'Select date'}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                  {errors.paymentDate && (
                    <Text style={styles.errorText}>{errors.paymentDate.message}</Text>
                  )}
                  {showDatePicker && (
                    <DateTimePicker
                      value={value ? new Date(value) : new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      maximumDate={new Date()}
                      onChange={(_: DateTimePickerEvent, date?: Date) => {
                        setShowDatePicker(Platform.OS === 'ios');
                        if (date) onChange(date.toISOString().split('T')[0]);
                      }}
                    />
                  )}
                </View>
              )}
            />

            {/* Payment method selector */}
            <View style={styles.methodSection}>
              <Text style={styles.methodLabel}>Payment Method *</Text>
              <View style={styles.methodGrid}>
                {PAYMENT_METHODS.map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.methodChip, selectedMethod === m.value && styles.methodChipActive]}
                    onPress={() => {
                      setSelectedMethod(m.value);
                      setValue('paymentMethod', m.value);
                    }}
                  >
                    <Text style={[styles.methodText, selectedMethod === m.value && styles.methodTextActive]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* UPI payment section — deep link + QR fallback for iOS */}
            {selectedMethod === 'UPI' && upiId && myBill && (() => {
              const amount = parseFloat(myBill.pendingAmount).toFixed(2);
              const note = activePeriod ? billingPeriodName(activePeriod) : 'Maintenance';
              const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent('Society')}&am=${amount}&tn=${encodeURIComponent(note)}&cu=INR`;

              return (
                <>
                  {/* Tap-to-open UPI deep link */}
                  <TouchableOpacity
                    style={styles.upiCard}
                    onPress={() =>
                      Linking.openURL(upiLink).catch(() =>
                        Alert.alert('No UPI App', 'Could not open a UPI app. Scan the QR code below with PhonePe, GPay, or any UPI app.'),
                      )
                    }
                    activeOpacity={0.85}
                  >
                    <View style={styles.upiCardLeft}>
                      <Ionicons name="qr-code-outline" size={28} color={colors.primary} />
                      <View style={styles.upiCardText}>
                        <Text style={styles.upiCardTitle}>Pay ₹{parseFloat(myBill.pendingAmount).toLocaleString('en-IN')} via UPI</Text>
                        <Text style={styles.upiCardSub}>Opens PhonePe · GPay · Paytm · BHIM</Text>
                        <Text style={styles.upiCardId}>{upiId}</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                  </TouchableOpacity>

                  {/* QR code — generated locally, no network required */}
                  <View style={styles.qrSection}>
                    <View style={styles.qrDivider}>
                      <View style={styles.qrDividerLine} />
                      <Text style={styles.qrDividerText}>or scan QR</Text>
                      <View style={styles.qrDividerLine} />
                    </View>
                    <View style={styles.qrBox}>
                      <QRCode
                        value={upiLink}
                        size={180}
                        color="#000000"
                        backgroundColor="#FFFFFF"
                      />
                      <Text style={styles.qrHint}>Open PhonePe / GPay → Scan QR</Text>
                      <Text style={styles.qrId}>{upiId}</Text>
                    </View>
                  </View>
                </>
              );
            })()}

            <Controller
              control={control}
              name="referenceNumber"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Transaction ID / UTR / Cheque No."
                  placeholder="Enter reference number"
                  value={value ?? ''}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  leftIcon="document-text-outline"
                  hint="Helps admin verify faster"
                />
              )}
            />

            <Controller
              control={control}
              name="notes"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Notes (Optional)"
                  placeholder="Any additional information"
                  value={value ?? ''}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  multiline
                  numberOfLines={3}
                />
              )}
            />

            <View style={styles.disclaimer}>
              <Ionicons name="information-circle-outline" size={16} color={colors.info} />
              <Text style={styles.disclaimerText}>
                Your payment will be reviewed and verified by the society admin before being marked as official.
              </Text>
            </View>

            <Button
              label="Submit Payment"
              onPress={handleSubmit(onSubmit)}
              loading={submitMutation.isPending}
              fullWidth
              size="lg"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.base, gap: spacing.xl, paddingBottom: spacing['4xl'] },

  billSummary: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    gap: spacing.sm,
  },
  billPeriod: { ...typography.labelLarge, color: colors.primary },
  billAmounts: { flexDirection: 'row', gap: spacing.xl },
  billAmountItem: { gap: 2 },
  billAmountLabel: { ...typography.bodySmall, color: colors.textSecondary },
  billAmountValue: { ...typography.headingSmall, color: colors.text },

  sectionTitle: { ...typography.headingSmall, color: colors.text },
  form: { gap: spacing.base },

  methodSection: { gap: spacing.sm },
  methodLabel: { ...typography.labelLarge, color: colors.text },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  methodChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  methodChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  methodText: { ...typography.labelMedium, color: colors.textSecondary },
  methodTextActive: { color: colors.primary },

  fieldLabel: {
    ...typography.labelLarge,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  dateTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  dateText: {
    ...typography.bodyMedium,
    color: colors.text,
    flex: 1,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    marginTop: 4,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.infoLight,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  disclaimerText: { ...typography.bodySmall, color: colors.info, flex: 1, lineHeight: 18 },

  upiCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryLight,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  upiCardLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  upiCardText: { flex: 1 },
  upiCardTitle: { ...typography.labelLarge, color: colors.primary },
  upiCardSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  upiCardId: { ...typography.bodySmall, color: colors.primary, fontFamily: 'monospace', marginTop: 2 },

  qrSection: { gap: spacing.sm },
  qrDivider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qrDividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  qrDividerText: { ...typography.bodySmall, color: colors.textTertiary },
  qrBox: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },
  qrImage: { width: 180, height: 180, borderRadius: radius.sm },
  qrHint: { ...typography.bodySmall, color: colors.textSecondary },
  qrId: { ...typography.labelSmall, color: colors.textTertiary, fontFamily: 'monospace' },
});
