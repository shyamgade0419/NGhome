import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuthContext } from '@/auth/AuthContext';
import { LoadingState } from '@/components/ui/LoadingState';
import { hasSeenWelcome } from '@/onboarding/welcome';

export default function Index() {
  const { isAuthenticated, isLoading, needsSocietySelection } = useAuthContext();
  // null until the phone says whether it has shown the welcome slides. Only a signed-out person needs the answer.
  const [seenWelcome, setSeenWelcome] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void hasSeenWelcome().then((v) => alive && setSeenWelcome(v));
    return () => {
      alive = false;
    };
  }, []);

  if (isLoading) return <LoadingState fullscreen message="Starting NG Home..." />;

  if (!isAuthenticated) {
    if (needsSocietySelection) return <Redirect href="/(society-select)" />;
    if (seenWelcome === null) return <LoadingState fullscreen message="Starting NG Home..." />;
    // The first time on this phone, before signing in: three slides on what the app does.
    if (!seenWelcome) return <Redirect href={'/welcome' as any} />;
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(app)" />;
}
