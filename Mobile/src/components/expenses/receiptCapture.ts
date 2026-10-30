import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Receipt, fromCamera, fromPicker } from '@/utils/receipts';

/**
 * Open the camera and hand back the photo, or null if nothing was taken. When the camera is off for
 * the app the person is told how to turn it on — a silent nothing reads as a broken button.
 */
export async function takePhoto(): Promise<Receipt | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    if (permission.canAskAgain) {
      Alert.alert('Camera is off', 'Allow the camera when asked, to photograph a bill.');
    } else {
      Alert.alert('Camera is off', 'Turn the camera on for NG Home in your phone\'s settings, then try again.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ]);
    }
    return null;
  }

  // A bill is read at arm's length: 0.7 keeps it legible at a fraction of the size, so it uploads
  // quickly on mobile data and stays well under the 10 MB limit.
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false });
  if (result.canceled || !result.assets?.[0]) return null;
  return fromCamera(result.assets[0], new Date());
}

/** A photo already on the phone, or a PDF of the bill. */
export async function chooseFile(): Promise<Receipt | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  return fromPicker(result.assets[0]);
}
