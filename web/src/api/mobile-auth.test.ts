import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ exchangeMobileSession: vi.fn() }));
const storage = vi.hoisted(() => ({ isNativeIOS: vi.fn(), saveMobileSessionToken: vi.fn() }));
const browser = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
const app = vi.hoisted(() => ({ getLaunchUrl: vi.fn(), addListener: vi.fn() }));

vi.mock('./auth', () => ({ authApi: auth }));
vi.mock('./mobile-session', () => storage);
vi.mock('@capacitor/browser', () => ({ Browser: browser }));
vi.mock('@capacitor/app', () => ({ App: app }));

import { consumeMobileAuthCallback, listenForMobileAuthCallback, openAuthorization } from './mobile-auth';

beforeEach(() => {
  vi.clearAllMocks();
  storage.isNativeIOS.mockReturnValue(true);
  browser.close.mockResolvedValue(undefined);
  app.getLaunchUrl.mockResolvedValue(undefined);
  app.addListener.mockResolvedValue({ remove: vi.fn() });
});

describe('mobile OAuth callback', () => {
  it('rejects a URL outside the configured Universal Link path', async () => {
    await expect(consumeMobileAuthCallback('https://example.com/ios/auth/callback?auth=success&handoff=x')).resolves.toBeNull();
    expect(auth.exchangeMobileSession).not.toHaveBeenCalled();
  });

  it('exchanges a valid callback handoff and stores only the returned session token', async () => {
    auth.exchangeMobileSession.mockResolvedValue({ token: 'mobile-token', expiresAt: '2099-01-01T00:00:00.000Z', user: {} });

    await expect(consumeMobileAuthCallback('https://note.wwenj.com/ios/auth/callback?auth=success&handoff=one-time')).resolves.toEqual({ kind: 'authenticated' });
    expect(browser.close).toHaveBeenCalledOnce();
    expect(auth.exchangeMobileSession).toHaveBeenCalledWith('one-time');
    expect(storage.saveMobileSessionToken).toHaveBeenCalledWith('mobile-token');
  });

  it('handles foreground Universal Link callbacks through Capacitor App', async () => {
    let listener: ((event: { url: string }) => void) | undefined;
    app.addListener.mockImplementation(async (_event: string, callback: (event: { url: string }) => void) => {
      listener = callback;
      return { remove: vi.fn() };
    });
    auth.exchangeMobileSession.mockResolvedValue({ token: 'mobile-token', expiresAt: '2099-01-01T00:00:00.000Z', user: {} });
    const onCallback = vi.fn();

    await listenForMobileAuthCallback(onCallback);
    listener?.({ url: 'https://note.wwenj.com/ios/auth/callback?auth=success&handoff=one-time' });
    await vi.waitFor(() => expect(onCallback).toHaveBeenCalledWith({ kind: 'authenticated' }));
  });

  it('opens GitHub in the system browser on iOS', async () => {
    await openAuthorization('https://github.com/login/oauth/authorize');
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://github.com/login/oauth/authorize', presentationStyle: 'fullscreen' });
  });
});
