// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceController } from './useWorkspaceController';

const api = vi.hoisted(() => ({
  connection: vi.fn(),
  repository: vi.fn(),
  syncStatus: vi.fn(),
  syncRun: vi.fn(),
  tree: vi.fn(),
}));

const verified = {
  state: 'verified' as const,
  phase: 'completed' as const,
  dirtyCount: 0,
  conflictCount: 0,
  generation: 1,
  verifiedGeneration: 1,
  remoteHead: 'head',
  verifiedAt: '',
  lastError: '',
  manualSyncAvailable: true,
};

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error { constructor(message: string, readonly status = 0) { super(message); } },
  githubApi: { connection: api.connection, disconnect: vi.fn(), repositories: vi.fn(), startRepositoryAuthorization: vi.fn() },
  settingsApi: { repository: api.repository, saveRepository: vi.fn() },
  syncApi: { status: api.syncStatus, run: api.syncRun },
  notesApi: { tree: api.tree, content: vi.fn(), create: vi.fn(), update: vi.fn(), createFolder: vi.fn(), remove: vi.fn() },
}));

vi.mock('../api/http', () => ({
  ApiError: class ApiError extends Error { constructor(message: string, readonly status = 0) { super(message); } },
  apiUrl: (path = '') => `/api/${path}`,
}));

vi.mock('../lib/workspace-cache', () => ({
  clearCachedAssets: vi.fn(), clearCachedWorkspace: vi.fn(), readCachedDocument: vi.fn(),
  removeCachedDocument: vi.fn(), writeCachedDocument: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  api.connection.mockResolvedValue({ connected: true, login: 'man', repository: 'man/notes' });
  api.repository.mockResolvedValue({ repository: 'man/notes', branch: 'main' });
  api.syncStatus.mockResolvedValue(verified);
  api.syncRun.mockResolvedValue(verified);
  api.tree.mockResolvedValue({ files: [], folders: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('workspace sync trigger', () => {
  it('首屏、定时器和页面重新可见都不会自动触发同步', async () => {
    renderHook(() => useWorkspaceController());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.syncRun).not.toHaveBeenCalled();
  });
});
