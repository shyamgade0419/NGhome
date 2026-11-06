import React, { useEffect } from 'react';
import { router, Stack, usePathname } from 'expo-router';
import { POLL_EVERY_MS, STALE_AFTER_MS, startLiveRefresh } from '@/query/liveRefresh';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from '@/auth/AuthContext';
import { BackHandler, Platform, StyleSheet } from 'react-native';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: STALE_AFTER_MS,
      gcTime: 5 * 60_000,
      // What is on screen is re-read every half minute while the app is open (not in the background — React
      // Query pauses it once the app is no longer in focus), and again the moment the app comes back to the front.
      refetchInterval: POLL_EVERY_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export default function RootLayout() {
  // The heading font is bundled with the app; the splash screen stays up for the instant it takes to register it, so no
  // screen ever draws first in the system font. If it cannot load, the app carries on in the system font.
  const [fontsLoaded, fontError] = useFonts({ PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Refetch when the app returns to the front, when the network is back, and when a push arrives.
  useEffect(() => startLiveRefresh(queryClient), []);

  // Opening another screen: the tabs stay mounted behind it, so a tab last read minutes ago would otherwise be
  // shown as it was. Anything past its freshness window is re-read as soon as the person lands on it.
  const pathname = usePathname();
  useEffect(() => {
    void queryClient.refetchQueries({ type: 'active', stale: true });
  }, [pathname]);

  // Android's hardware back button is a well-documented gap in this exact
  // stack (expo-router + Tabs holding hidden detail screens like
  // admin/payments/[id] as plain Tabs.Screen siblings rather than a nested
  // Stack): the on-screen back arrow works because ScreenHeader calls
  // router.back() directly, but the hardware key bypasses expo-router's own
  // history and falls through to React Navigation/Android's default —
  // which, once it can't find anything to pop at that level, closes the
  // whole app instead of going up a screen. Feeding hardware back into the
  // same router.back() call as the on-screen arrow fixes it without needing
  // to restructure every tab into its own nested Stack.
  // https://github.com/expo/expo/issues/33489
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canGoBack()) {
        router.back();
        return true;
      }
      return false; // nothing left to go back to — let Android exit the app as normal
    });
    return () => sub.remove();
  }, []);

  // Tapping a push notification (app backgrounded or fully closed) should
  // land on the notification the person actually tapped, not just
  // whatever screen happened to be open before. expo-router's navigation
  // isn't necessarily mounted yet the instant this fires on a cold start,
  // so this only ever pushes forward from wherever restoreSession/login
  // eventually lands — never a hard replace that could fight the auth
  // redirect logic in (app)/_layout.tsx.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void queryClient.invalidateQueries(); // opened from a push: show what it is about, not what was loaded before
      const type = (response.notification.request.content.data as { type?: unknown } | undefined)?.type;
      // A visitor at the gate needs an answer now: go straight to the right screen for this person.
      // Anything else lands on the notification list, as before.
      if (type === 'VISITOR_REQUEST' || type === 'VISITOR_ARRIVED' || type === 'VISITOR_OVERRIDE') {
        router.push('/(app)/visitors' as any);
      } else if (type === 'HELPER_ARRIVED' || type === 'HELPER_SUSPENDED') {
        router.push('/(app)/household-help' as any);
      } else if (type === 'PARKING_ALLOCATED' || type === 'PARKING_RELEASED' || type === 'VEHICLE_REMOVED') {
        router.push('/(app)/vehicles' as any);
      } else if (type === 'PARCEL_RECEIVED') {
        router.push('/(app)/deliveries' as any);
      } else if (type === 'VISITOR_DECISION') {
        router.push('/(app)/guard' as any);
      } else {
        router.push('/(app)/notifications' as any);
      }
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="welcome" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(society-select)" />
              <Stack.Screen name="(app)" />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
