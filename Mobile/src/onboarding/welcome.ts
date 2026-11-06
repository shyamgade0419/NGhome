import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'nghome.welcomeSeen.v1';

/**
 * Whether this phone has already shown the welcome slides. If storage cannot be read the answer is "yes": a phone that
 * cannot remember must not be sent through the slides on every launch.
 */
export async function hasSeenWelcome(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markWelcomeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // Not being able to remember only means the slides may show again.
  }
}
