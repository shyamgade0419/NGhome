import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import apiClient from '@/api/client';
import { colors, typography } from '@/theme';
import { TabIcon } from '@/components/nav/TabIcon';

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
          // The 28px icon pill, the 16px label and the tab item's own 5px above and below (10px) must all fit inside what
          // is left after the bar's 1px border and 8px padding each side: 56 left the label 9px tall and cut its letters.
          height: 74 + Math.max(insets.bottom - 8, 0),
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        // Always under the icon. React Navigation moves the label beside the icon whenever the screen is wider than it
        // is tall (landscape, a tablet, a foldable), and a six-tab bar leaves each label about 65px, so every label was
        // cut down to its first letter.
        tabBarLabelPosition: 'below-icon',
        // Sentence case: a six-tab bar leaves each label about 55px, and capitals with letter-spacing ('DASHBOARD',
        // 'COMMUNITY') are wider than that, so they were cut short.
        tabBarLabelStyle: {
          ...typography.labelSmall,
          fontSize: 10,
          letterSpacing: 0,
          textTransform: 'none',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'grid' : 'grid-outline'} tone="teal" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="maintenance/index"
        options={{
          title: 'Billing',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'receipt' : 'receipt-outline'} tone="blue" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="water/index"
        options={{
          title: 'Water',
          href: waterEnabled ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'water' : 'water-outline'} tone="teal" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="payments/index"
        options={{
          title: 'Payments',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'card' : 'card-outline'} tone="green" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses/index"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'wallet' : 'wallet-outline'} tone="coral" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="announcements/index"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'megaphone' : 'megaphone-outline'} tone="violet" focused={focused} color={color} />
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
      <Tabs.Screen name="opening-balances/index" options={{ href: null }} />
      <Tabs.Screen name="flat-discounts/index" options={{ href: null }} />
      <Tabs.Screen name="advance-credit/index" options={{ href: null }} />
      <Tabs.Screen name="amenities/index" options={{ href: null }} />
      <Tabs.Screen name="visitors/index" options={{ href: null }} />
      <Tabs.Screen name="amenities/bookings" options={{ href: null }} />
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
