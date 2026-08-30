import { Stack } from 'expo-router';

export default function RegisterLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Society admin registration */}
      <Stack.Screen name="index" />
      <Stack.Screen name="society-info" />
      <Stack.Screen name="admin-details" />
      <Stack.Screen name="complete" />
      {/* Resident join flow */}
      <Stack.Screen name="join-code" />
      <Stack.Screen name="resident-details" />
    </Stack>
  );
}
