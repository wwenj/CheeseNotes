import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { isNativeIOS } from './mobile-session';

const deviceTokenKey = 'noteai.device.token';
let activeDeviceToken: string | null | undefined;

export async function deviceToken() {
  if (activeDeviceToken !== undefined) return activeDeviceToken;
  activeDeviceToken = isNativeIOS() ? await SecureStorage.getItem(deviceTokenKey) : localStorage.getItem(deviceTokenKey);
  return activeDeviceToken;
}

export async function saveDeviceToken(token: string) {
  if (isNativeIOS()) {
    await SecureStorage.set(deviceTokenKey, token, true, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  } else {
    localStorage.setItem(deviceTokenKey, token);
  }
  activeDeviceToken = token;
}

export async function clearDeviceToken() {
  if (isNativeIOS()) {
    await SecureStorage.remove(deviceTokenKey, false);
  } else {
    localStorage.removeItem(deviceTokenKey);
  }
  activeDeviceToken = null;
}
