// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileActionSheet } from './ReaderViews';

afterEach(() => cleanup());

describe('FileActionSheet', () => {
  it('按目录层级进入并移动到当前目录', async () => {
    const onMove = vi.fn().mockResolvedValue(false);
    render(<FileActionSheet file={{ id: 'one', path: '收件箱/文章.md', revision: 'r1' }} folders={['项目', '项目/计划', '归档']} mode="read" onClose={vi.fn()} onModeChange={vi.fn()} onCopy={vi.fn()} onFavorite={vi.fn()} onMove={onMove} onDelete={vi.fn().mockResolvedValue(false)} />);

    fireEvent.click(screen.getByRole('button', { name: '移动到目录' }));
    expect(screen.getByText('项目')).toBeTruthy();
    expect(screen.getByText('归档')).toBeTruthy();
    expect(screen.queryByText('计划')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    expect(await screen.findByText('计划')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '移动到此目录' }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('项目'));
  });

  it('移动和 GitHub 同步验证期间显示 loading 并禁止关闭弹窗', () => {
    const onMove = vi.fn(() => new Promise<boolean>(() => undefined));
    render(<FileActionSheet file={{ id: 'one', path: '收件箱/文章.md', revision: 'r1' }} folders={['归档']} mode="read" onClose={vi.fn()} onModeChange={vi.fn()} onCopy={vi.fn()} onFavorite={vi.fn()} onMove={onMove} onDelete={vi.fn().mockResolvedValue(false)} />);

    fireEvent.click(screen.getByRole('button', { name: '移动到目录' }));
    fireEvent.click(screen.getByRole('button', { name: '移动到此目录' }));

    expect(screen.getByRole('status').textContent).toContain('正在完成 GitHub 同步验证，请稍候。');
    expect((screen.getByRole('button', { name: '关闭文件操作' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '正在移动并同步…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
