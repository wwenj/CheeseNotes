// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileManagement from './FileManagement';

const managementTree = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({ notesApi: { managementTree } }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('FileManagement', () => {
  it('默认收起目录，删除只预览，确认后一次提交', async () => {
    const snapshot = {
      files: [{ id: 'one', path: '收件箱/文章.md', revision: 'r1' }],
      folders: ['收件箱', '归档'],
      treeVersion: 'tree-1',
    };
    managementTree.mockResolvedValue(snapshot);
    const onApply = vi.fn().mockResolvedValue({ ...snapshot, files: [], folders: ['归档'], sync: { state: 'verified' } });

    render(<FileManagement onApply={onApply} onClose={vi.fn()} onNotice={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByText('收件箱')).toBeTruthy();
    expect(screen.queryByText('文章')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开 收件箱' }));
    expect(await screen.findByText('文章')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '打开 文章 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(screen.queryByText('文章')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('tree-1', [{ type: 'delete-file', id: 'one', path: '收件箱/文章.md', revision: 'r1' }]));
  });

  it('确认失败后清空预览并重新读取本地树', async () => {
    const snapshot = { files: [{ id: 'one', path: '文章.md', revision: 'r1' }], folders: [], treeVersion: 'tree-1' };
    const refreshed = { files: [{ id: 'two', path: '远端.md', revision: 'r2' }], folders: [], treeVersion: 'tree-2' };
    managementTree.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(refreshed);
    const onApply = vi.fn().mockRejectedValue(new Error('GitHub 文件结构已变化'));
    const onError = vi.fn();

    render(<FileManagement onApply={onApply} onClose={vi.fn()} onNotice={vi.fn()} onError={onError} />);
    expect(await screen.findByText('文章')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开 文章 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(await screen.findByText('远端')).toBeTruthy();
    expect(managementTree).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith('GitHub 文件结构已变化，文件结构已刷新，请重新操作。');
  });
});
