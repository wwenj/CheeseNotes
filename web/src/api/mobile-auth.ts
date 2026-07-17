import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { authApi } from './auth';
import { isNativeIOS, saveMobileSessionToken } from './mobile-session';

export type MobileAuthCallback =
  | { kind: 'authenticated' }
  | { kind: 'forbidden' }
  | { kind: 'repository-connected' }
  | { kind: 'error'; message: string };

const callbackOrigin = 'https://note.wwenj.com';
const callbackPath = '/ios/auth/callback';

export async function openAuthorization(url: string) {
  if (isNativeIOS()) {
    await Browser.open({ url, presentationStyle: 'fullscreen' });
    return;
  }
  window.location.assign(url);
}

export async function consumeMobileAuthCallback(value: string): Promise<MobileAuthCallback | null> {
  if (!isNativeIOS()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== callbackOrigin || url.pathname !== callbackPath) return null;

  await Browser.close().catch(() => undefined);
  const auth = url.searchParams.get('auth');
  const github = url.searchParams.get('github');
  if (auth === 'success') {
    const handoff = url.searchParams.get('handoff');
    if (!handoff) return { kind: 'error', message: '移动端登录凭据缺失，请重新使用 GitHub 登录。' };
    const session = await authApi.exchangeMobileSession(handoff);
    await saveMobileSessionToken(session.token);
    return { kind: 'authenticated' };
  }
  if (auth === 'forbidden') return { kind: 'forbidden' };
  if (auth === 'error') return { kind: 'error', message: url.searchParams.get('reason') || 'GitHub 登录没有完成。' };
  if (github === 'connected') return { kind: 'repository-connected' };
  if (github === 'error') return { kind: 'error', message: url.searchParams.get('reason') || 'GitHub 授权没有完成。' };
  return null;
}

export async function listenForMobileAuthCallback(onCallback: (callback: MobileAuthCallback) => void | Promise<void>) {
  if (!isNativeIOS()) return () => undefined;
  let active = true;
  const handle = async (url: string) => {
    if (!active) return;
    try {
      const callback = await consumeMobileAuthCallback(url);
      if (callback) await onCallback(callback);
    } catch {
      await onCallback({ kind: 'error', message: '无法完成移动端登录，请重新使用 GitHub 登录。' });
    }
  };
  const launch = await App.getLaunchUrl();
  if (launch?.url) await handle(launch.url);
  const listener = await App.addListener('appUrlOpen', ({ url }) => { void handle(url); });
  return () => {
    active = false;
    void listener.remove();
  };
}
