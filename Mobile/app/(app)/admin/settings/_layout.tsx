/**
 * Settings gets its own Stack so "back" returns to the Settings list rather
 * than the admin Tabs navigator's default route (Dashboard).
 *
 * Before this file existed, every settings/*.tsx screen was registered as a
 * flat, hidden sibling directly on the admin Tabs navigator. Tabs navigators
 * don't maintain real push/pop history the way a Stack does, so
 * router.back() from e.g. Society Settings had nothing to pop back to and
 * fell through to the tab's initial route — Dashboard — for every settings
 * sub-screen, no matter how it was reached.
 */
import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="society" />
      <Stack.Screen name="roles" />
      <Stack.Screen name="residents" />
      <Stack.Screen name="buildings" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="billing" />
    </Stack>
  );
}
