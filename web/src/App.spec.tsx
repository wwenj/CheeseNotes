// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const api = vi.hoisted(() => ({
  session: vi.fn(),
  startGitHubLogin: vi.fn(),
  exchangeMobileSession: vi.fn(),
}));

const github = vi.hoisted(() => ({ startRepositoryAuthorization: vi.fn() }));

const workspace = vi.hoisted(() => ({
  resetEditor: vi.fn(), reload: vi.fn(), setNotice: vi.fn(), setError: vi.fn(), setSync: vi.fn(),
  loadFile: vi.fn(), revealFolder: vi.fn(), createNote: vi.fn(), toggleFolder: vi.fn(), collapseAllFolders: vi.fn(), expandAllFolders: vi.fn(),
  createFolder: vi.fn(), runSync: vi.fn(), chooseRepository: vi.fn(), clearReadingCache: vi.fn(), disconnect: vi.fn(),
  updateDraftContent: vi.fn(), flushCurrentDraft: vi.fn(), changeArticleMode: vi.fn(), retryDocumentUpdate: vi.fn(), setSheetOpen: vi.fn(),
  copyArticle: vi.fn(), deleteCurrentArticle: vi.fn(),
  loading: false, auth: { connected: true, login: 'man', repository: 'man/notes' }, repository: 'man/notes',
  files: [], folders: [], selected: null, note: null, draft: null, expanded: new Set<string>(), sync: null,
  error: null, notice: null, clientSettings: { readerFontSize: 18 }, articleMode: 'read', documentRefresh: null, sheetOpen: false,
}));

vi.mock('./api', () => ({
  authApi: api,
  githubApi: github,
  authExpiredEvent: 'noteai:auth-expired',
}));
vi.mock('./api/mobile-auth', () => ({
  listenForMobileAuthCallback: vi.fn().mockResolvedValue(() => undefined),
  openAuthorization: vi.fn(),
}));
vi.mock('./api/mobile-session', () => ({
  isNativeIOS: () => false,
  clearMobileSessionToken: vi.fn(),
}));
vi.mock('./app/useWorkspaceController', () => ({ useWorkspaceController: () => workspace }));
vi.mock('./app/routes', () => ({
  navigate: vi.fn(), panelForRoute: () => 'vault', pathForPanel: () => '/', useAppRoute: () => ({ pathname: '/' }),
}));
vi.mock('./components/feedback/Toast', () => ({ default: () => <div /> }));
vi.mock('./components/layout/WorkspaceShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="workspace-shell">{children}</div> }));
vi.mock('./features/reader/ReaderViews', () => ({
  ArticleActionSheet: () => <div />, ArticleToolbar: () => <div />, DocumentView: () => <div />,
}));
vi.mock('./features/settings/RepositorySettings', () => ({ default: () => <div /> }));
vi.mock('./features/sync/SyncPanel', () => ({ default: () => <div /> }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(workspace, {
    loading: false, auth: { connected: true, login: 'man', repository: 'man/notes' }, repository: 'man/notes', error: null, notice: null,
  });
  window.history.replaceState({}, '', '/');
});

afterEach(() => cleanup());

describe('application access gate', () => {
  it('shows GitHub login before any workspace state', async () => {
    api.session.mockResolvedValue({ authenticated: false, user: null });
    render(<App />);

    expect(await screen.findByRole('heading', { name: '使用 GitHub 登录' })).toBeTruthy();
    expect(screen.queryByTestId('workspace-shell')).toBeNull();
  });

  it('shows the dedicated denial screen and consumes the callback state', async () => {
    window.history.replaceState({}, '', '/?auth=forbidden');
    api.session.mockResolvedValue({ authenticated: false, user: null });
    render(<App />);

    expect(await screen.findByRole('heading', { name: '暂无使用权限' })).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('renders the workspace only after a valid local session', async () => {
    api.session.mockResolvedValue({ authenticated: true, user: { id: 'user-1', githubId: 'github-42', login: 'man', email: 'man@wwenj.com', avatarUrl: null } });
    render(<App />);

    expect(await screen.findByTestId('workspace-shell')).toBeTruthy();
  });
});
