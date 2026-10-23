import { Stack } from 'expo-router';

export default function AmenitiesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="mine" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
