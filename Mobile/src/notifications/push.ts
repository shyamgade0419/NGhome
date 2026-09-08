/**
 * Real push delivery — a phone alert when the app isn't open — as opposed
 * to the in-app notification list. expo-notifications was installed and
 * configured as a build-time config plugin (native icon/channel) from the
 * start, but nothing ever actually requested permission, registered a
 * device, or listened for a tap. This is that missing runtime half.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { notificationsApi } from '@/api/endpoints/notifications.api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ng_push_token';

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

/**
 * Requests permission and registers this device with the backend.
 * Best-effort everywhere — a denied permission, a simulator with no push
 * capability, or a network hiccup should never block login or crash the
 * app; it just means this device won't get push notifications.
 */
export async function registerForPushNotificationsAsync(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      // Android 8+ requires a channel to exist before a notification can
      // be shown on it — expo-notifications' config plugin sets the icon/
      // color at build time, but the channel itself is a runtime call.
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
    if (finalStatus !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await AsyncStorage.setItem(STORAGE_KEY, token);
    await notificationsApi.registerPushToken(token, Platform.OS);
  } catch {
    // Simulators/emulators without Google Play services, a denied
    // permission dialog, or the backend call failing all land here —
    // none of them should be treated as a real error the user sees.
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
