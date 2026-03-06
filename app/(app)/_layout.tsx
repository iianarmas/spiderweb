import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="project/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="project/[id]/index" />
      <Stack.Screen name="project/[id]/guide" />
    </Stack>
  );
}
