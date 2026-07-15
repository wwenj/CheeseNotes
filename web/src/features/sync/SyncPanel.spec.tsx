// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConflictDetail, SyncConflict, SyncStatus } from '../../api';
import SyncPanel from './SyncPanel';

const api = vi.hoisted(() => ({
  conflicts: vi.fn(),
  conflict: vi.fn(),
  saveDecision: vi.fn(),
  saveAllDecisions: vi.fn(),
  applyDecisions: vi.fn(),
}));

vi.mock('../../api', () => ({
  ApiError: class ApiError extends Error {},
  githubApi: {},
  syncApi: api,
}));

const status = (overrides: Partial<SyncStatus> = {}): SyncStatus => ({
  state: 'conflict', phase: 'idle', currentPath: '', processedFiles: 0, totalFiles: 0, processedBytes: 0, totalBytes: 0,
  pendingCount: 0, conflictCount: 1, resolutionDraftCount: 0, syncBlockedByConflicts: true, lastSuccessAt: '', lastError: '', manualSyncAvailable: false,
  ...overrides,
});

const conflict = (overrides: Partial<SyncConflict> = {}): SyncConflict => ({
  id: 'conflict-a', path: '项目/a.md', remote_commit: 'remote-a', created_at: '2026-07-15T00:00:00.000Z', operation: 'update',
  resolution_action: null, resolution_copy_path: null, local_bytes: 12, remote_bytes: 12,
  ...overrides,
});

const detail = (overrides: Partial<ConflictDetail> = {}): ConflictDetail => ({
  ...conflict(), base_content: '共同内容', local_content: '本地内容', remote_content: '远端内容', resolution_content: null, resolution_updated_at: null,
  ...overrides,
});

beforeEach(() => Object.values(api).forEach((mock) => mock.mockReset()));
afterEach(() => cleanup());

function renderPanel(overrides: Partial<Parameters<typeof SyncPanel>[0]> = {}) {
  const props = {
    sync: status(), onSync: vi.fn().mockResolvedValue(undefined), onSyncStatus: vi.fn(), onRefresh: vi.fn(), onError: vi.fn(), onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<SyncPanel {...props} />), props };
}

describe('SyncPanel', () => {
  it('使用设置式标题和关闭按钮，按需展开本地与远端内容', async () => {
    api.conflicts.mockResolvedValue({ items: [conflict()], nextCursor: null, total: 1, resolutionDraftCount: 0 });
    api.conflict.mockResolvedValue(detail());
    const user = userEvent.setup();
    const { props } = renderPanel();

    expect(screen.getByRole('heading', { name: '同步冲突' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭同步冲突' }));
    expect(props.onClose).toHaveBeenCalledOnce();
    await user.click(await screen.findByText('查看本地与远端内容'));
    await waitFor(() => expect(api.conflict).toHaveBeenCalledWith('conflict-a'));
    expect(await screen.findByText('本地')).toBeTruthy();
    expect(screen.getByText('远端')).toBeTruthy();
  });

  it('选择全部处理方式后，最后一次点击同时保存并开始处理', async () => {
    api.conflicts.mockResolvedValue({ items: [conflict()], nextCursor: null, total: 1, resolutionDraftCount: 0 });
    api.saveAllDecisions.mockResolvedValue({ ok: true, sync: status({ resolutionDraftCount: 1 }) });
    api.applyDecisions.mockResolvedValue(status({ state: 'syncing', phase: 'merging', resolutionDraftCount: 1 }));
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText('项目/a.md');
    expect((screen.getAllByRole('radio', { name: /保留两个版本/ })[0] as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getAllByRole('radio', { name: /采用远端/ })[0]);
    const article = screen.getByText('项目/a.md').closest('article')!;
    expect((within(article).getByRole('radio', { name: /采用远端/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: '处理冲突' }));
    await waitFor(() => expect(api.saveAllDecisions).toHaveBeenCalledWith('use-remote'));
    expect(api.applyDecisions).toHaveBeenCalledOnce();
  });

  it('允许为单条冲突直接选择三种方式之一', async () => {
    const item = conflict();
    api.conflicts.mockResolvedValue({ items: [item], nextCursor: null, total: 1, resolutionDraftCount: 0 });
    api.saveDecision.mockResolvedValue({ ok: true, conflict: detail({ resolution_action: 'keep-local' }), sync: status({ resolutionDraftCount: 1 }) });
    const user = userEvent.setup();
    renderPanel();

    const article = (await screen.findByText(item.path)).closest('article')!;
    expect(within(article).getAllByRole('radio')).toHaveLength(3);
    await user.click(within(article).getByRole('radio', { name: /保留本地/ }));
    await waitFor(() => expect(api.saveDecision).toHaveBeenCalledWith('conflict-a', 'keep-local'));
  });
});
