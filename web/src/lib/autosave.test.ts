import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoSaveQueue, type AutoSaveDraft } from './autosave';

const baseDraft = (overrides: Partial<AutoSaveDraft> = {}): AutoSaveDraft => ({
  workspaceKey: 'service::owner/repository',
  path: '收件箱/草稿.md',
  content: '初始内容',
  revision: 'r0',
  updatedAt: 1,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AutoSaveQueue', () => {
  it('合并连续输入，只保存最后一版', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue({ kind: 'saved', revision: 'r1' } as const);
    const queue = new AutoSaveQueue({ persist, clear, save, onSaved: vi.fn(), onRetrying: vi.fn(), onBlocked: vi.fn() });
    queue.ensure(baseDraft());

    queue.update({ ...baseDraft(), content: '第一版' });
    queue.update({ ...baseDraft(), content: '最终版' });
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ content: '最终版', revision: 'r0' }));
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ content: '最终版' }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('请求进行中继续编辑时，使用新 revision 保存最终内容', async () => {
    vi.useFakeTimers();
    let finishFirst: ((value: { kind: 'saved'; revision: string }) => void) | undefined;
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise<{ kind: 'saved'; revision: string }>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ kind: 'saved', revision: 'r2' } as const);
    const queue = new AutoSaveQueue({ persist: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined), save, onSaved: vi.fn(), onRetrying: vi.fn(), onBlocked: vi.fn() });
    queue.ensure(baseDraft());

    queue.update({ ...baseDraft(), content: '第一版' });
    await vi.advanceTimersByTimeAsync(500);
    queue.update({ ...baseDraft(), content: '第二版' });
    finishFirst?.({ kind: 'saved', revision: 'r1' });
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).toMatchObject({ content: '第一版', revision: 'r0' });
    expect(save.mock.calls[1][0]).toMatchObject({ content: '第二版', revision: 'r1' });
  });

  it('立即 flush 可保存空正文，不等待 500ms', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ kind: 'saved', revision: 'r1' } as const);
    const queue = new AutoSaveQueue({ persist: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined), save, onSaved: vi.fn(), onRetrying: vi.fn(), onBlocked: vi.fn() });
    queue.ensure(baseDraft());

    queue.update({ ...baseDraft(), content: '' });
    await expect(queue.flush('service::owner/repository', '收件箱/草稿.md')).resolves.toBe(true);

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ content: '', revision: 'r0' }));
  });

  it('恢复本机草稿后立即续传', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ kind: 'saved', revision: 'r1' } as const);
    const queue = new AutoSaveQueue({ persist: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined), save, onSaved: vi.fn(), onRetrying: vi.fn(), onBlocked: vi.fn() });

    queue.restore(baseDraft({ content: '恢复内容', updatedAt: 100 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ content: '恢复内容', revision: 'r0' }));
  });

  it('保存失败时保留本机草稿并安排重试', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const retrying = vi.fn();
    const queue = new AutoSaveQueue({ persist, clear, save, onSaved: vi.fn(), onRetrying: retrying, onBlocked: vi.fn() });
    queue.ensure(baseDraft());

    queue.update({ ...baseDraft(), content: '离线内容' });
    await vi.advanceTimersByTimeAsync(500);
    expect(clear).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ content: '离线内容' }));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(retrying).toHaveBeenCalledTimes(1);
  });

  it('revision 冲突不会覆盖服务端内容', async () => {
    vi.useFakeTimers();
    const blocked = vi.fn();
    const save = vi.fn().mockResolvedValue({ kind: 'blocked' } as const);
    const queue = new AutoSaveQueue({ persist: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined), save, onSaved: vi.fn(), onRetrying: vi.fn(), onBlocked: blocked });
    queue.ensure(baseDraft());

    queue.update({ ...baseDraft(), content: '本机版本' });
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledTimes(1);
    expect(blocked).toHaveBeenCalledTimes(1);
  });
});
