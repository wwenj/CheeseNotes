// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false }));
const secureStorage = vi.hoisted(() => ({
  get: vi.fn(),
  getItem: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('./platform', () => ({ isNativeIOS: () => platform.native }));
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { whenUnlockedThisDeviceOnly: 1 },
  SecureStorage: secureStorage,
}));

beforeEach(() => {
  platform.native = false;
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  vi.resetModules();
});

describe('device access storage', () => {
  it('keeps the browser-generated multipart boundary for FormData requests', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchWithAuthorization } = await import('./http');
    const body = new FormData();
    body.append('sourcePath', '文章.md');

    await fetchWithAuthorization('https://example.com/api/files/images', { method: 'POST', body });

    const options = fetchMock.mock.calls[0][1]!;
    expect(new Headers(options.headers).has('Content-Type')).toBe(false);
  });

  it('reads the decoded iOS Keychain value after an app restart', async () => {
    platform.native = true;
    secureStorage.get.mockResolvedValue('trusted-device-token');
    const access = await import('./device-access');

    await expect(access.deviceToken()).resolves.toBe('trusted-device-token');
    expect(secureStorage.get).toHaveBeenCalledWith('noteai.device.token');
    expect(secureStorage.getItem).not.toHaveBeenCalled();
  });

  it('keeps a newly saved token immediately available to API requests', async () => {
    const access = await import('./device-access');

    await access.saveDeviceToken('new-device-token');
    localStorage.removeItem('noteai.device.token');

    await expect(access.deviceToken()).resolves.toBe('new-device-token');
  });

  it('clears both persistent and in-memory token state', async () => {
    const access = await import('./device-access');
    await access.saveDeviceToken('device-token');

    await access.clearDeviceToken();

    expect(localStorage.getItem('noteai.device.token')).toBeNull();
    await expect(access.deviceToken()).resolves.toBeNull();
  });
});
