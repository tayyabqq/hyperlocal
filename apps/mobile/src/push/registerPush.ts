import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { DevicePlatform } from '@hl/shared';
import { registerDevice } from '../api/notifications';

/**
 * Requests notification permission and registers this device's native FCM token
 * with the API. Android is the launch platform (P1), so we take the device push
 * token — the raw FCM registration token — rather than an Expo push token, to
 * match the backend's FCM v1 sender.
 *
 * Best-effort: a simulator, denied permission, or missing native config just
 * means no push. Chat still works over the socket, so this never blocks login.
 */
export async function registerPushToken(accessToken: string): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (typeof token !== 'string' || token.length === 0) return;

    const platform = Platform.OS === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID;
    await registerDevice(accessToken, token, platform);
  } catch {
    // Non-fatal: push is an enhancement, not a requirement for using the app.
  }
}
