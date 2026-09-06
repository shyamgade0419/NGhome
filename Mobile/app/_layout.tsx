import React, { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from '@/auth/AuthContext';
import { BackHandler, Platform, StyleSheet } from 'react-native';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

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
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/(app)/notifications' as any);
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
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
