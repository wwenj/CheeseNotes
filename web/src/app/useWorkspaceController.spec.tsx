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
  pendingCount: 0,
  conflictCount: 0,
  currentPath: '',
  processedFiles: 0,
  totalFiles: 0,
  processedBytes: 0,
  totalBytes: 0,
  resolutionDraftCount: 0,
  syncBlockedByConflicts: false,
  lastSuccessAt: '',
  lastError: '',
  lastRemoteHead: 'head',
  verifiedRemoteHead: 'head',
  localGeneration: 1,
  verifiedGeneration: 1,
  nextRetryAt: '',
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
  api.tree.mockResolvedValue({ files: [], folders: [], etag: 'tree' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('workspace automatic sync', () => {
  it('首屏同步一次，之后每 15 分钟同步，不在页面重新可见时同步', async () => {
    renderHook(() => useWorkspaceController());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.syncRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(api.syncRun).toHaveBeenCalledTimes(2);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.syncRun).toHaveBeenCalledTimes(2);
  });
});
