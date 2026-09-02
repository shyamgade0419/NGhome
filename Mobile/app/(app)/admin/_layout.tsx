import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
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
          height: 64,
          paddingBottom: 8,
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
      <Tabs.Screen name="salaries/index" options={{ href: null }} />
      <Tabs.Screen name="audit-logs/index" options={{ href: null }} />
      <Tabs.Screen name="billing-rules/index" options={{ href: null }} />
      <Tabs.Screen name="payments/[id]" options={{ href: null }} />
      <Tabs.Screen name="billing/[id]" options={{ href: null }} />
      {/* settings/_layout.tsx nests all seven settings/* screens in their own
          Stack so "back" returns to the Settings list, not Dashboard. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="profile/index" options={{ href: null }} />
    </Tabs>
  );
}
