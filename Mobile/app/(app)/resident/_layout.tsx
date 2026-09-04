import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '@/theme';

export default function ResidentLayout() {
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
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="maintenance"
        options={{
          title: 'My Bills',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={color} />
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
        name="helpdesk"
        options={{
          title: 'Helpdesk',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'construct' : 'construct-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'megaphone' : 'megaphone-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person-circle' : 'person-circle-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      {/* Navigable but hidden from tab bar */}
      <Tabs.Screen name="payments/submit" options={{ href: null }} />
      <Tabs.Screen name="bills/[id]" options={{ href: null }} />
      <Tabs.Screen name="finances" options={{ href: null }} />
      <Tabs.Screen name="events/index" options={{ href: null }} />
    </Tabs>
  );
}
