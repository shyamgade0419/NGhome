/**
 * Real push delivery — a phone alert, with a sound, when the app isn't open — as opposed to the in-app notification
 * list. expo-notifications was installed and configured as a build-time config plugin (native icon/channel) from the
 * start, but nothing ever actually requested permission, registered a device, or listened for a tap. This is that
 * missing runtime half.
 *
 * Registration used to swallow every failure silently, so a phone that could not receive pushes looked exactly like
 * one that simply had none yet. The outcome is now kept (see getPushStatus) and shown on the notifications screen.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { notificationsApi } from '@/api/endpoints/notifications.api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ng_push_token';
const STATUS_KEY = 'ng_push_status';

/** The Android channel pushes are sent on: loud, with a heads-up banner. The server names the same channel. */
export const ALERT_CHANNEL = 'alerts';

export type PushState =
  /** This phone is registered and will get alerts. */
  | 'ready'
  /** The person turned notifications off for the app; only they can turn them back on, in the phone's settings. */
  | 'denied'
  /** The phone could not be registered: no Google Play services, or the build has no push credentials. */
  | 'unavailable';

export interface PushStatus {
  state: PushState;
  /** What went wrong, for the person to read or pass on. */
  detail?: string;
}

// Foreground behavior — without this, a push that arrives while the app is
// already open does nothing visible at all (expo-notifications' default
// is to NOT show a banner/play a sound in the foreground).
// SDK 54 note: the old shouldShowAlert was split into shouldShowBanner (the
// heads-up alert) and shouldShowList (the entry kept in the notification
// centre). We want both — same visible behavior as before the split.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function remember(status: PushStatus): Promise<PushStatus> {
  try {
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(status));
  } catch {
    // Only a diagnostic — never worth failing over.
  }
  return status;
}

/** How push registration last went on this phone, or null if it has not been tried yet. */
export async function getPushStatus(): Promise<PushStatus | null> {
  try {
    const raw = await AsyncStorage.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as PushStatus) : null;
  } catch {
    return null;
  }
}

/**
 * Requests permission and registers this device with the backend.
 * Best-effort everywhere — a denied permission, a simulator with no push
 * capability, or a network hiccup should never block login or crash the
 * app; it just means this device won't get push notifications. The outcome is returned (and kept) so the app
 * can say why, instead of staying quiet.
 */
export async function registerForPushNotificationsAsync(): Promise<PushStatus> {
  try {
    if (Platform.OS === 'android') {
      // Android 8+ requires a channel to exist before a notification can be shown on it, and a channel's
      // loudness is fixed once it is created — so the loud one is a new channel rather than a change to
      // 'default'. Both stay: a push that names no channel still lands somewhere that sounds.
      await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
        name: 'Alerts',
        description: 'Visitors at the gate, payments, bills and announcements',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return remember({ state: 'denied', detail: 'Notifications are turned off for NG Home on this phone.' });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return remember({ state: 'unavailable', detail: 'This build has no push project id.' });

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return remember({ state: 'unavailable', detail: 'The phone did not return a push token.' });

    await AsyncStorage.setItem(STORAGE_KEY, token);
    await notificationsApi.registerPushToken(token, Platform.OS);
    return remember({ state: 'ready' });
  } catch (err) {
    // Emulators without Google Play services, a build without Firebase credentials (Android cannot hand out a
    // push token without them), or the backend call failing all land here. None should show the person an error
    // screen — but the reason is kept, because "no alerts" with no explanation cannot be fixed.
    const detail = err instanceof Error ? err.message : String(err);
    return remember({ state: 'unavailable', detail });
  }
}

/** Called on logout so a signed-out device stops receiving push
 *  notifications meant for whoever's no longer using it. */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEY);
    if (!token) return;
    await notificationsApi.unregisterPushToken(token);
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort — logout must proceed either way.
  }
}
