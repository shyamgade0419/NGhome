import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { colors, spacing, typography } from '@/theme';

const schema = z.object({
  name: z.string().min(3, 'Society name must be at least 3 characters'),
  registrationNumber: z.string().optional(),
  address: z.string().min(5, 'Enter full address'),
  city: z.string().min(2, 'Enter city'),
  state: z.string().min(2, 'Enter state'),
  pinCode: z.string().regex(/^\d{4,10}$/, 'Enter valid PIN code'),
  country: z.string().min(2, 'Enter country'),
  contactEmail: z.string().email('Enter valid email'),
  contactPhone: z.string().regex(/^\+?\d{7,15}$/, 'Enter valid phone number'),
});

type FormData = z.infer<typeof schema>;

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={stepStyles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            stepStyles.dot,
            i < current && stepStyles.done,
            i === current && stepStyles.active,
          ]}
        />
      ))}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginBottom: spacing.xl },
  dot: {
    height: 4,
    flex: 1,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  done: { backgroundColor: colors.secondary },
  active: { backgroundColor: colors.primary },
});

export default function SocietyInfoScreen() {
  const router = useRouter();

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { country: 'India' },
  });

  const onNext = async (data: FormData) => {
    await AsyncStorage.setItem('reg_society', JSON.stringify(data));
    router.push('/(auth)/register/admin-details');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Register Society" subtitle="Step 1 of 2" showBack />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <StepIndicator current={0} total={2} />

          <Text style={styles.sectionTitle}>Society Information</Text>
          <Text style={styles.sectionSubtitle}>Tell us about your apartment community</Text>

          <View style={styles.form}>
            <Controller control={control} name="name" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Society Name" placeholder="Green Valley Apartments" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.name?.message} required />
            )} />

            <Controller control={control} name="registrationNumber" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Registration Number (Optional)" placeholder="e.g. MH-2023-12345" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} hint="Cooperative housing society registration number" />
            )} />

            <Controller control={control} name="address" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Address" placeholder="Plot No. 12, Sector 5" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.address?.message} required multiline numberOfLines={2} />
            )} />

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Controller control={control} name="city" render={({ field: { onChange, onBlur, value } }) => (
                  <Input label="City" placeholder="Mumbai" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.city?.message} required />
                )} />
              </View>
              <View style={styles.flex1}>
                <Controller control={control} name="state" render={({ field: { onChange, onBlur, value } }) => (
                  <Input label="State" placeholder="Maharashtra" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.state?.message} required />
                )} />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Controller control={control} name="pinCode" render={({ field: { onChange, onBlur, value } }) => (
                  <Input label="PIN Code" placeholder="400001" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.pinCode?.message} keyboardType="numeric" required />
                )} />
              </View>
              <View style={styles.flex1}>
                <Controller control={control} name="country" render={({ field: { onChange, onBlur, value } }) => (
                  <Input label="Country" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.country?.message} required />
                )} />
              </View>
            </View>

            <Controller control={control} name="contactEmail" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Society Email" placeholder="admin@greenvalley.com" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.contactEmail?.message} keyboardType="email-address" autoCapitalize="none" required leftIcon="mail-outline" />
            )} />

            <Controller control={control} name="contactPhone" render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Contact Phone" placeholder="+91 9876543210" value={value ?? ''} onChangeText={onChange} onBlur={onBlur} error={errors.contactPhone?.message} keyboardType="phone-pad" required leftIcon="call-outline" />
            )} />

            <Button label="Continue" onPress={handleSubmit(onNext)} fullWidth size="lg" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  flex1: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.base, paddingBottom: spacing['4xl'] },
  sectionTitle: { ...typography.headingMedium, color: colors.text },
  sectionSubtitle: { ...typography.bodyMedium, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xl },
  form: { gap: spacing.base },
  row: { flexDirection: 'row', gap: spacing.md },
});
