import { Redirect } from 'expo-router';
import { useAuthContext } from '@/auth/AuthContext';
import { LoadingState } from '@/components/ui/LoadingState';

export default function Index() {
  const { isAuthenticated, isLoading, needsSocietySelection } = useAuthContext();

  if (isLoading) return <LoadingState fullscreen message="Starting NG Home..." />;

  if (!isAuthenticated) {
    if (needsSocietySelection) return <Redirect href="/(society-select)" />;
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(app)" />;
}
