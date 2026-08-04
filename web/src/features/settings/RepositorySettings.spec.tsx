// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepositorySettings from './RepositorySettings';

afterEach(() => cleanup());

describe('RepositorySettings Authenticator access', () => {
  it('clears local access from the Authenticator page', async () => {
    const onClearAuthenticatorAccess = vi.fn().mockResolvedValue(undefined);

    render(<RepositorySettings
      repository="man/notes"
      auth={{ connected: true, login: 'man', repository: 'man/notes' }}
      readerFontSize={18}
      onReaderFontSizeChange={vi.fn()}
      onClearReadingCache={vi.fn().mockResolvedValue(undefined)}
      onClearAuthenticatorAccess={onClearAuthenticatorAccess}
      onDisconnect={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Authenticator 验证' }));

    expect(screen.getByRole('heading', { name: 'Authenticator 验证' })).toBeTruthy();
    expect(screen.queryByText('当前设备')).toBeNull();
    expect(screen.queryByText('验证状态')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '删除当前设备验证' }));

    await waitFor(() => expect(onClearAuthenticatorAccess).toHaveBeenCalledTimes(1));
  });
});
