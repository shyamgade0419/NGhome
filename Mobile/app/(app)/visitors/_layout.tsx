import { Stack } from 'expo-router';

export default function VisitorsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="invite" />
      <Stack.Screen name="invitations" />
    </Stack>
  );
}
