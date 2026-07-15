// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../../api';
import Explorer from './Explorer';

vi.mock('../FileTree', () => ({ default: () => <div /> }));
vi.mock('./ExplorerTools', () => ({ default: () => <div /> }));

afterEach(() => cleanup());

const conflictSync: SyncStatus = {
  state: 'conflict', phase: 'idle', currentPath: '', processedFiles: 0, totalFiles: 0, processedBytes: 0, totalBytes: 0,
  pendingCount: 0, conflictCount: 3, resolutionDraftCount: 1, syncBlockedByConflicts: true, lastSuccessAt: '', lastError: '', manualSyncAvailable: false,
};

describe('Explorer sync status', () => {
  it('存在冲突时只跳转到冲突工作台，不发起重复同步', async () => {
    const onPanel = vi.fn();
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Explorer files={[]} folders={[]} expanded={new Set()} search="" activeTool={null} sync={conflictSync} panel="vault" onSearch={vi.fn()} onToolChange={vi.fn()} onToggle={vi.fn()} onCollapseAll={vi.fn()} onExpandAll={vi.fn()} onRevealFolder={vi.fn()} onSelect={vi.fn()} onNewFile={vi.fn()} onCreateFolder={vi.fn().mockResolvedValue(true)} onPanel={onPanel} onSync={onSync} />);

    await userEvent.setup().click(screen.getByRole('button', { name: '处理 3 个同步冲突' }));
    expect(onPanel).toHaveBeenCalledWith('sync');
    expect(onSync).not.toHaveBeenCalled();
  });
});
