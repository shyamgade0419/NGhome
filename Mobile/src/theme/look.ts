import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * The look of the app. `glass` (the default) is frosted surfaces over a soft aurora; `classic` is the flat warm-beige look the app
 * had before.
 *
 * The app's colours are fixed into its stylesheets when a screen first loads, so the look cannot change while the app is open.
 * It is read once, here, when the app starts (secure storage can be read synchronously, which is what makes that possible), and
 * a new choice is kept for the next time the app opens. `appliedLook` is what this run is drawn in; `chosenLook()` is what the
 * person last picked, which differs from it only between choosing and reopening.
 */
export type Look = 'glass' | 'classic';

export const LOOK_KEY = 'nghome_look';
export const DEFAULT_LOOK: Look = 'glass';

const clean = (v: unknown): Look => (v === 'classic' || v === 'glass' ? v : DEFAULT_LOOK);

function readRaw(): string | null {
  try {
    if (Platform.OS === 'web') return typeof localStorage !== 'undefined' ? localStorage.getItem(LOOK_KEY) : null;
    return SecureStore.getItem(LOOK_KEY);
  } catch {
    return null; // storage unavailable: the default look
  }
}

/** What the person last chose (the default until they choose). */
export const chosenLook = (): Look => clean(readRaw());

/** The look this run of the app is drawn in. Fixed for the life of the app. */
export const appliedLook: Look = chosenLook();
export const isGlass = appliedLook === 'glass';

/** Keep a choice for the next time the app opens. Never throws. */
export async function saveLook(look: Look): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LOOK_KEY, look);
      return;
    }
    await SecureStore.setItemAsync(LOOK_KEY, look);
  } catch {
    /* the choice could not be kept; the app carries on in the look it has */
  }
}
