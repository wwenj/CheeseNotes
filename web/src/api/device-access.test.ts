// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platform', () => ({ isNativeIOS: () => false }));

beforeEach(() => {
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
