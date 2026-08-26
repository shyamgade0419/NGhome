import { Stack } from 'expo-router';

export default function RegisterLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="society-info" />
      <Stack.Screen name="admin-details" />
      <Stack.Screen name="complete" />
    </Stack>
  );
}
