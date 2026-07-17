import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { accessApi, accessRequiredEvent, ApiError, githubApi, type AccessRequiredDetail, type NoteSummary } from './api';
import { clearDeviceToken, deviceToken, saveDeviceToken } from './api/device-access';
import { listenForMobileAuthCallback, openAuthorization, type MobileAuthCallback } from './api/mobile-auth';
import { isNativeIOS } from './api/mobile-session';
import { useWorkspaceController } from './app/useWorkspaceController';
import { navigate, panelForRoute, pathForPanel, useAppRoute } from './app/routes';
import type { Panel } from './app/types';
import Toast from './components/feedback/Toast';
import WorkspaceShell from './components/layout/WorkspaceShell';
import type { ExplorerTool } from './components/layout/ExplorerTools';
import { ArticleActionSheet, ArticleToolbar, DocumentView } from './features/reader/ReaderViews';
import RepositorySettings from './features/settings/RepositorySettings';
import SyncPanel from './features/sync/SyncPanel';
import { AuthenticatorGate, ConnectGitHub, InitializationProgress, RepositoryPicker, SetupScreen } from './features/setup/SetupScreens';
import { isMarkdown } from './lib/files';

const ArticleEditor = lazy(() => import('./features/reader/ArticleEditor'));

export default function App() {
  const route = useAppRoute();
  const panel = panelForRoute(route.pathname);
  const [accessState, setAccessState] = useState<'checking' | 'required' | 'authorized'>('checking');
  const [accessError, setAccessError] = useState<string | null>(null);
  const workspace = useWorkspaceController(accessState === 'authorized');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openExplorerOnReturn, setOpenExplorerOnReturn] = useState(false);
  const [activeExplorerTool, setActiveExplorerTool] = useState<ExplorerTool | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    void accessApi.status()
      .then(async (status) => {
        if (!active) return;
        if (status.authorized) {
          setAccessState('authorized');
          return;
        }
        await clearDeviceToken();
        if (active) setAccessState('required');
      })
      .catch(() => {
        if (!active) return;
        setAccessError('无法读取设备授权状态，请检查服务连接。');
        setAccessState('required');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const requireAccess = async (event: Event) => {
      const rejectedToken = (event as CustomEvent<AccessRequiredDetail>).detail?.rejectedToken ?? null;
      const currentToken = await deviceToken();
      if (currentToken !== rejectedToken) return;
      await clearDeviceToken();
      setAccessError(null);
      setAccessState('required');
    };
    const listener = (event: Event) => { void requireAccess(event); };
    window.addEventListener(accessRequiredEvent, listener);
    return () => window.removeEventListener(accessRequiredEvent, listener);
  }, []);

  const verifyAccess = useCallback(async (code: string) => {
    setAccessError(null);
    const result = await accessApi.verify(code);
    await saveDeviceToken(result.token);
    try {
      const status = await accessApi.status();
      if (status.authorized) {
        setAccessState('authorized');
        return;
      }
      throw new ApiError('设备授权未生效，请重新验证。');
    } catch (reason) {
      await clearDeviceToken();
      setAccessState('required');
      throw reason;
    }
  }, []);

  const clearAuthenticatorAccess = useCallback(async () => {
    await clearDeviceToken();
    setAccessError(null);
    setAccessState('required');
    navigate('/');
  }, []);

  const handleMobileAuthCallback = useCallback(async (callback: MobileAuthCallback) => {
    if (callback.kind === 'repository-connected') {
      await workspace.reload(false);
      workspace.setNotice('GitHub 已连接，请选择要同步的笔记库。');
      return;
    }
    if (callback.kind === 'error') workspace.setError(callback.message);
  }, [workspace.reload, workspace.setError, workspace.setNotice]);

  useEffect(() => {
    if (accessState !== 'authorized') return;
    let remove: () => void = () => undefined;
    void listenForMobileAuthCallback(handleMobileAuthCallback).then((listener) => { remove = listener; });
    return () => remove();
  }, [accessState, handleMobileAuthCallback]);

  const navigateToPanel = useCallback((nextPanel: Panel) => {
    const nextPath = pathForPanel(nextPanel);
    if (nextPanel !== 'vault') workspace.resetEditor();
    setDrawerOpen(false);
    navigate(nextPath);
  }, [workspace.resetEditor]);

  const closeSettingsToExplorer = useCallback(() => {
    workspace.resetEditor();
    setOpenExplorerOnReturn(true);
    navigate('/');
  }, [workspace.resetEditor]);

  const openFile = useCallback((file: NoteSummary) => {
    setDrawerOpen(false);
    navigate('/');
    void workspace.loadFile(file);
  }, [workspace.loadFile]);

  const openNew = useCallback(() => {
    setDrawerOpen(false);
    navigate('/');
    void workspace.createNote();
  }, [workspace.createNote]);

  const openDocumentPath = useCallback((path: string) => {
    const file = workspace.files.find((item) => item.path === path);
    if (file) openFile(file);
  }, [openFile, workspace.files]);

  const closeExplorerTool = useCallback(() => {
    setActiveExplorerTool(null);
    setSearch('');
  }, []);

  const changeExplorerTool = useCallback((tool: ExplorerTool | null) => {
    const next = activeExplorerTool === tool ? null : tool;
    setActiveExplorerTool(next);
    if (next !== 'search') setSearch('');
  }, [activeExplorerTool]);

  const openNewFromExplorer = useCallback(() => {
    closeExplorerTool();
    openNew();
  }, [closeExplorerTool, openNew]);

  const selectFileFromSearch = useCallback((file: NoteSummary) => {
    closeExplorerTool();
    openFile(file);
  }, [closeExplorerTool, openFile]);

  const revealFolderFromSearch = useCallback((path: string) => {
    closeExplorerTool();
    setDrawerOpen(false);
    navigate('/');
    workspace.revealFolder(path);
  }, [closeExplorerTool, workspace.revealFolder]);

  useEffect(() => {
    if (route.pathname !== '/') workspace.resetEditor();
    setDrawerOpen(false);
    closeExplorerTool();
  }, [closeExplorerTool, route.pathname, workspace.resetEditor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeExplorerTool) {
        closeExplorerTool();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch('');
        setActiveExplorerTool('search');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeExplorerTool, closeExplorerTool]);

  useEffect(() => {
    if (activeExplorerTool !== 'search' || search.trim()) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-explorer-tools]')) return;
      closeExplorerTool();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [activeExplorerTool, closeExplorerTool, search]);

  useEffect(() => {
    if (!openExplorerOnReturn || route.pathname !== '/') return;
    setDrawerOpen(true);
    setOpenExplorerOnReturn(false);
  }, [openExplorerOnReturn, route.pathname]);

  useEffect(() => {
    if (accessState !== 'authorized') return;
    const params = new URLSearchParams(window.location.search);
    const github = params.get('github');
    if (github === 'connected') {
      void workspace.reload(false);
      workspace.setNotice('GitHub 已连接，请选择要同步的笔记库。');
    }
    if (github === 'error') workspace.setError(params.get('reason') || 'GitHub 授权没有完成。');
    if (params.has('auth') || params.has('github')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('auth');
      url.searchParams.delete('github');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [accessState, workspace.reload, workspace.setError, workspace.setNotice]);

  const closeError = useCallback(() => workspace.setError(null), [workspace.setError]);
  const closeNotice = useCallback(() => workspace.setNotice(null), [workspace.setNotice]);
  const feedback = workspace.error
    ? <Toast key={`error:${workspace.error}`} kind="error" value={workspace.error} onClose={closeError} />
    : workspace.notice ? <Toast key={`notice:${workspace.notice}`} kind="notice" value={workspace.notice} onClose={closeNotice} /> : null;

  const startRepositoryConnection = useCallback(async () => {
    const authorization = await githubApi.startRepositoryAuthorization(isNativeIOS() ? 'ios' : 'web');
    await openAuthorization(authorization.url);
  }, []);

  if (accessState === 'checking') return <SetupScreen><LoaderCircle className="spin" size={21} />正在检查设备授权</SetupScreen>;
  if (accessState === 'required') return <SetupScreen centered><AuthenticatorGate error={accessError} onVerify={verifyAccess} /></SetupScreen>;
  if (workspace.loading && !workspace.auth) return <SetupScreen><LoaderCircle className="spin" size={21} />正在读取本地设置</SetupScreen>;
  if (!workspace.auth?.connected) return <SetupScreen feedback={feedback}><ConnectGitHub error={workspace.error} onConnect={startRepositoryConnection} /></SetupScreen>;
  if (!workspace.repository) return <SetupScreen feedback={feedback}><RepositoryPicker login={workspace.auth.login} onSelect={workspace.chooseRepository} /></SetupScreen>;
  if (workspace.sync?.state === 'checking' && workspace.sync && !workspace.files.length) return <SetupScreen feedback={feedback}><InitializationProgress sync={workspace.sync} onRetry={workspace.runSync} /></SetupScreen>;

  const explorer = {
    files: workspace.files,
    folders: workspace.folders,
    selectedPath: workspace.selected?.path,
    expanded: workspace.expanded,
    search,
    activeTool: activeExplorerTool,
    sync: workspace.sync,
    panel,
    onSearch: setSearch,
    onToolChange: changeExplorerTool,
    onToggle: workspace.toggleFolder,
    onCollapseAll: workspace.collapseAllFolders,
    onExpandAll: workspace.expandAllFolders,
    onRevealFolder: revealFolderFromSearch,
    onSelect: activeExplorerTool === 'search' ? selectFileFromSearch : openFile,
    onNewFile: openNewFromExplorer,
    onCreateFolder: workspace.createFolder,
    onPanel: navigateToPanel,
    onSync: workspace.runSync,
  };

  const editingArticle = workspace.draft && workspace.note && workspace.selected
    ? { draft: workspace.draft, note: workspace.note, selected: workspace.selected }
    : null;
  const vaultContent = editingArticle
    ? workspace.articleMode === 'write'
      ? <Suspense fallback={<div className="document-loading" role="status"><LoaderCircle className="spin" size={20} /></div>}><ArticleEditor key={editingArticle.selected.path} draft={editingArticle.draft} readerFontSize={workspace.clientSettings.readerFontSize} sourcePath={editingArticle.selected.path} files={workspace.files} onChange={workspace.updateDraftContent} onSave={() => { void workspace.flushCurrentDraft(); }} /></Suspense>
      : <DocumentView selected={editingArticle.selected} note={{ ...editingArticle.note, content: editingArticle.draft.content }} files={workspace.files} loading={workspace.loading || workspace.loadingFile} readerFontSize={workspace.clientSettings.readerFontSize} onOpen={openDocumentPath} onNew={openNew} />
    : <DocumentView selected={workspace.selected} note={workspace.note} files={workspace.files} loading={workspace.loading || workspace.loadingFile} readerFontSize={workspace.clientSettings.readerFontSize} onOpen={openDocumentPath} onNew={openNew} />;

  const content = panel === 'vault' ? vaultContent
    : panel === 'sync' ? <SyncPanel sync={workspace.sync} onSync={workspace.runSync} onSyncStatus={workspace.setSync} onRefresh={() => void workspace.reload(false, { preserveCurrentDocument: true, forceTreeRefresh: true })} onError={workspace.setError} onClose={closeSettingsToExplorer} />
      : <RepositorySettings repository={workspace.repository} auth={workspace.auth} readerFontSize={workspace.clientSettings.readerFontSize} onReaderFontSizeChange={workspace.setReaderFontSize} onClearReadingCache={workspace.clearReadingCache} onClearAuthenticatorAccess={clearAuthenticatorAccess} onDisconnect={workspace.disconnect} onClose={closeSettingsToExplorer} />;

  return <WorkspaceShell
    explorer={explorer}
    drawerOpen={drawerOpen}
    onDrawerOpen={() => setDrawerOpen(true)}
    onDrawerClose={() => setDrawerOpen(false)}
    showMobileMenu={panel === 'vault'}
    feedback={feedback}
    toolbar={panel === 'vault' && workspace.note && isMarkdown(workspace.selected?.path ?? '') ? <ArticleToolbar articleMode={workspace.articleMode} refreshState={workspace.documentRefresh} onToggle={() => void workspace.changeArticleMode(workspace.articleMode === 'read' ? 'write' : 'read')} onOpenMenu={() => workspace.setSheetOpen(true)} onRetry={workspace.retryDocumentUpdate} /> : null}
  >
    {content}
    {workspace.sheetOpen && workspace.note && <ArticleActionSheet mode={workspace.articleMode} onClose={() => workspace.setSheetOpen(false)} onModeChange={(mode) => void workspace.changeArticleMode(mode)} onCopy={() => void workspace.copyArticle()} onFavorite={() => { workspace.setSheetOpen(false); workspace.setNotice('收藏功能即将支持。'); }} onDelete={() => void workspace.deleteCurrentArticle()} />}
  </WorkspaceShell>;
}
