import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

const sessionKey = 'noteai.mobile.session';

export const isNativeIOS = () => Capacitor.getPlatform() === 'ios';

export async function mobileSessionToken() {
  if (!isNativeIOS()) return null;
  return SecureStorage.getItem(sessionKey);
}

export async function saveMobileSessionToken(token: string) {
  if (!isNativeIOS()) return;
  await SecureStorage.set(sessionKey, token, true, false, KeychainAccess.whenUnlockedThisDeviceOnly);
}

export async function clearMobileSessionToken() {
  if (!isNativeIOS()) return;
  await SecureStorage.remove(sessionKey, false);
}
