import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import apiClient from '@/api/client';
import { colors, typography } from '@/theme';

export default function AdminLayout() {
  // Water tab is hidden when the society has turned off water billing
  // (Settings → Billing Configuration). Defaults to shown while loading and
  // for societies that never touched the setting, so existing behavior is
  // unchanged until an admin explicitly opts out.
  const { data: config } = useQuery({
    queryKey: ['society-config-mobile'],
    queryFn: () => apiClient.get('/societies/my/config').then((r: any) => r.data?.data ?? r.data),
    staleTime: 5 * 60_000,
  });
  const waterEnabled = config?.additionalConfig?.waterBillingEnabled ?? true;

  // Android 15+ (targetSdk 35+, which Play Store now requires) forces
  // edge-to-edge layout at the OS level — the app draws behind the system
  // nav bar instead of it reserving its own space. A fixed tabBarStyle
  // height/paddingBottom (the old values) no longer accounts for that bar,
  // so the tab icons ended up drawn underneath it. Padding by the real
  // inset keeps the tab bar clear of whatever nav style the device uses
  // (gesture pill or 3-button bar) instead of just guessing a fixed value.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 56 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: {
          ...typography.labelSmall,
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="maintenance/index"
        options={{
          title: 'Billing',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="water/index"
        options={{
          title: 'Water',
          href: waterEnabled ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'water' : 'water-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="payments/index"
        options={{
          title: 'Payments',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'card' : 'card-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses/index"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="announcements/index"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'megaphone' : 'megaphone-outline'} size={22} color={color} />
          ),
        }}
      />
      {/* Navigable but hidden from tab bar */}
      <Tabs.Screen name="helpdesk/index" options={{ href: null }} />
      <Tabs.Screen name="reports/index" options={{ href: null }} />
      <Tabs.Screen name="accounts/index" options={{ href: null }} />
      <Tabs.Screen name="meetings/index" options={{ href: null }} />
      <Tabs.Screen name="events/index" options={{ href: null }} />
      <Tabs.Screen name="salaries/index" options={{ href: null }} />
      <Tabs.Screen name="audit-logs/index" options={{ href: null }} />
      <Tabs.Screen name="billing-rules/index" options={{ href: null }} />
      <Tabs.Screen name="water/configs" options={{ href: null }} />
      <Tabs.Screen name="payments/[id]" options={{ href: null }} />
      <Tabs.Screen name="billing/[id]" options={{ href: null }} />
      {/* settings/_layout.tsx nests all seven settings/* screens in their own
          Stack so "back" returns to the Settings list, not Dashboard. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="profile/index" options={{ href: null }} />
    </Tabs>
  );
}
