// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const github = vi.hoisted(() => ({ openRepositoryAuthorization: vi.fn() }));
const access = vi.hoisted(() => ({
  status: vi.fn(),
  verify: vi.fn(),
}));
const deviceAccess = vi.hoisted(() => ({ deviceToken: vi.fn(), saveDeviceToken: vi.fn(), clearDeviceToken: vi.fn() }));

const workspace = vi.hoisted(() => ({
  resetEditor: vi.fn(), reload: vi.fn(), setNotice: vi.fn(), setError: vi.fn(), setSync: vi.fn(),
  loadFile: vi.fn(), revealFolder: vi.fn(), createNote: vi.fn(), toggleFolder: vi.fn(), collapseAllFolders: vi.fn(), expandAllFolders: vi.fn(),
  createFolder: vi.fn(), runSync: vi.fn(), chooseRepository: vi.fn(), clearReadingCache: vi.fn(), disconnect: vi.fn(),
  applyTreeChanges: vi.fn(), moveCurrentFile: vi.fn(), deleteCurrentFile: vi.fn(),
  updateDraftContent: vi.fn(), flushCurrentDraft: vi.fn(), changeArticleMode: vi.fn(), retryDocumentUpdate: vi.fn(), setSheetOpen: vi.fn(),
  copyArticle: vi.fn(),
  loading: false, auth: { connected: true, login: 'man', repository: 'man/notes' }, repository: 'man/notes',
  files: [], folders: [], selected: null, note: null, draft: null, expanded: new Set<string>(), sync: null,
  error: null, notice: null, clientSettings: { readerFontSize: 18 }, articleMode: 'read', documentRefresh: null, sheetOpen: false,
}));

vi.mock('./api', () => ({
  accessApi: access,
  accessRequiredEvent: 'noteai:access-required',
  ApiError: class ApiError extends Error {},
  githubApi: github,
}));
vi.mock('./api/device-access', () => deviceAccess);
vi.mock('./app/useWorkspaceController', () => ({ useWorkspaceController: () => workspace }));
vi.mock('./app/routes', () => ({
  navigate: vi.fn(), panelForRoute: (pathname: string) => pathname === '/settings' ? 'settings' : 'vault', pathForPanel: () => '/', useAppRoute: () => ({ pathname: window.location.pathname }),
}));
vi.mock('./components/feedback/Toast', () => ({ default: () => <div /> }));
vi.mock('./components/layout/WorkspaceShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="workspace-shell">{children}</div> }));
vi.mock('./features/reader/ReaderViews', () => ({
  FileActionSheet: () => <div />, DocumentToolbar: () => <div />, DocumentView: () => <div />,
}));
vi.mock('./features/settings/RepositorySettings', () => ({
  default: ({ onClearAuthenticatorAccess }: { onClearAuthenticatorAccess: () => Promise<void> }) => <button type="button" onClick={() => void onClearAuthenticatorAccess()}>测试退出验证</button>,
}));
vi.mock('./features/sync/SyncPanel', () => ({ default: () => <div /> }));
vi.mock('./features/manage/FileManagement', () => ({ default: () => <div /> }));

beforeEach(() => {
  vi.clearAllMocks();
  access.status.mockResolvedValue({ authorized: true });
  access.verify.mockResolvedValue({ authorized: true, token: 'trusted-device-token' });
  deviceAccess.deviceToken.mockResolvedValue('trusted-device-token');
  Object.assign(workspace, {
    loading: false, auth: { connected: true, login: 'man', repository: 'man/notes' }, repository: 'man/notes', error: null, notice: null,
  });
  window.history.replaceState({}, '', '/');
});

afterEach(() => cleanup());

describe('application access gate', () => {
  it('shows Authenticator before loading an untrusted device', async () => {
    access.status.mockResolvedValueOnce({ authorized: false });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Authenticator 验证' })).toBeTruthy();
    expect(screen.queryByTestId('workspace-shell')).toBeNull();
  });

  it('stores the device token and opens the workspace after verification', async () => {
    access.status.mockResolvedValueOnce({ authorized: false });
    render(<App />);

    const input = await screen.findByLabelText('Authenticator 验证码');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => expect(access.verify).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(deviceAccess.saveDeviceToken).toHaveBeenCalledWith('trusted-device-token'));
    expect(access.status).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy();
  });

  it('stays at the gate when the saved token cannot be confirmed', async () => {
    access.status.mockResolvedValueOnce({ authorized: false }).mockResolvedValueOnce({ authorized: false });
    render(<App />);

    const input = await screen.findByLabelText('Authenticator 验证码');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(await screen.findByText('设备授权未生效，请重新验证。')).toBeTruthy();
    expect(deviceAccess.clearDeviceToken).toHaveBeenCalled();
    expect(screen.queryByTestId('workspace-shell')).toBeNull();
  });

  it('returns to Authenticator when the current token is rejected later', async () => {
    render(<App />);
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy();

    fireEvent(window, new CustomEvent('noteai:access-required', {
      detail: { rejectedToken: 'trusted-device-token' },
    }));

    expect(await screen.findByRole('heading', { name: 'Authenticator 验证' })).toBeTruthy();
    expect(deviceAccess.clearDeviceToken).toHaveBeenCalled();
    expect(screen.queryByTestId('workspace-shell')).toBeNull();
  });

  it('returns to Authenticator after clearing this device access in settings', async () => {
    window.history.replaceState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '测试退出验证' }));

    expect(await screen.findByRole('heading', { name: 'Authenticator 验证' })).toBeTruthy();
    expect(deviceAccess.clearDeviceToken).toHaveBeenCalledTimes(1);
  });

  it('ignores a late rejection from an older token', async () => {
    deviceAccess.deviceToken.mockResolvedValue('new-device-token');
    render(<App />);
    expect(await screen.findByTestId('workspace-shell')).toBeTruthy();

    fireEvent(window, new CustomEvent('noteai:access-required', {
      detail: { rejectedToken: 'old-device-token' },
    }));

    await waitFor(() => expect(deviceAccess.deviceToken).toHaveBeenCalled());
    expect(deviceAccess.clearDeviceToken).not.toHaveBeenCalled();
    expect(screen.getByTestId('workspace-shell')).toBeTruthy();
  });

  it('shows repository connection directly without a system login', async () => {
    workspace.auth = { connected: false, login: '', repository: '' };
    workspace.repository = '';
    render(<App />);

    expect(await screen.findByRole('heading', { name: '连接你的笔记库' })).toBeTruthy();
    expect(screen.queryByTestId('workspace-shell')).toBeNull();
  });

  it('opens repository authorization without a mobile callback listener', async () => {
    workspace.auth = { connected: false, login: '', repository: '' };
    workspace.repository = '';
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '连接 GitHub' }));
    await waitFor(() => expect(github.openRepositoryAuthorization).toHaveBeenCalledOnce());
  });

  it('consumes a repository callback state', async () => {
    window.history.replaceState({}, '', '/?github=connected');
    render(<App />);

    await waitFor(() => expect(workspace.reload).toHaveBeenCalledWith(false));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('renders the workspace when the device token is valid', async () => {
    render(<App />);

    expect(await screen.findByTestId('workspace-shell')).toBeTruthy();
  });
});
