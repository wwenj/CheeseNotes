// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryPicker } from './SetupScreens';

const github = vi.hoisted(() => ({ repositories: vi.fn() }));

vi.mock('../../api', () => ({ githubApi: github }));

afterEach(() => cleanup());

describe('RepositoryPicker', () => {
  beforeEach(() => {
    github.repositories.mockResolvedValue([
      { fullName: 'man/notes', private: true, branch: 'main', updatedAt: '2026-07-20T00:00:00.000Z' },
    ]);
  });

  it('waits for confirmation before starting the clone', async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<RepositoryPicker onSelect={onSelect} />);

    const select = await screen.findByRole('combobox', { name: '选择笔记仓库' });
    fireEvent.change(select, { target: { value: 'man/notes' } });
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认克隆并同步仓库' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('man/notes'));
    expect(screen.queryByPlaceholderText('owner/repository')).toBeNull();
  });
});
