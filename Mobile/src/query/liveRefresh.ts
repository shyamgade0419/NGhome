/**
 * Keeps what is on screen current without the person pulling to refresh.
 *
 * React Query refetches on "window focus" and on reconnect, but in React Native there is no window: unless it is
 * told what "focus" and "online" mean here, it never refetches when the app is brought back from the background
 * or the network returns, and a screen keeps showing whatever it loaded the last time it was opened. Three things
 * fix that:
 *
 *  - the app coming to the foreground counts as focus, so stale data is refetched at once;
 *  - connectivity is read from the phone, so a refetch that failed offline is retried when the network is back;
 *  - a push notification arriving means something changed on the server (a payment approved, a visitor at the gate,
 *    a bill published), so everything on screen is refetched at that moment.
 */
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';

/** How long data counts as fresh, and how often what is on screen is re-read while the app is open. */
export const STALE_AFTER_MS = 15_000;
export const POLL_EVERY_MS = 30_000;

/** Connected, and the internet really reachable (null means "not known yet", which is treated as reachable). */
export function isOnline(state: { isConnected: boolean | null; isInternetReachable: boolean | null }): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/**
 * Wire React Query to the phone. Call once; returns a function that undoes it.
 */
export function startLiveRefresh(queryClient: QueryClient): () => void {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => handleFocus(status === 'active'));
    return () => sub.remove();
  });

  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(isOnline(state))));

  // A push arrived while the app is open: whatever it is about is now out of date on screen.
  const received = Notifications.addNotificationReceivedListener(() => {
    void queryClient.invalidateQueries();
  });

  return () => received.remove();
}
