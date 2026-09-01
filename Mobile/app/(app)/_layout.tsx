import React from 'react';
import { Stack, Redirect } from 'expo-router';
import { useAuthContext } from '@/auth/AuthContext';
import { LoadingState } from '@/components/ui/LoadingState';

export default function AppLayout() {
  const { isAuthenticated, isLoading, needsSocietySelection } = useAuthContext();

  if (isLoading) return <LoadingState fullscreen message="Loading your society..." />;

  if (!isAuthenticated) {
    if (needsSocietySelection) return <Redirect href="/(society-select)" />;
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="resident" />
      <Stack.Screen name="help" />
      <Stack.Screen name="maintenance-sheet" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
