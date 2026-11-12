import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '@/theme';
import { TabIcon } from '@/components/nav/TabIcon';

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
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'home' : 'home-outline'} tone="teal" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="maintenance"
        options={{
          title: 'My Bills',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'receipt' : 'receipt-outline'} tone="blue" focused={focused} color={color} />
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
        name="helpdesk"
        options={{
          title: 'Helpdesk',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'construct' : 'construct-outline'} tone="amber" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'megaphone' : 'megaphone-outline'} tone="violet" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'person-circle' : 'person-circle-outline'} tone="blue" focused={focused} color={color} />
          ),
        }}
      />
      {/* Navigable but hidden from tab bar */}
      <Tabs.Screen name="payments/submit" options={{ href: null }} />
      <Tabs.Screen name="bills/[id]" options={{ href: null }} />
      <Tabs.Screen name="finances" options={{ href: null }} />
      <Tabs.Screen name="reports" options={{ href: null }} />
      <Tabs.Screen name="events/index" options={{ href: null }} />
      <Tabs.Screen name="meetings" options={{ href: null }} />
    </Tabs>
  );
}
