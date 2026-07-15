import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { NoteSummary } from './api';
import { useWorkspaceController } from './app/useWorkspaceController';
import { navigate, panelForRoute, pathForPanel, useAppRoute } from './app/routes';
import type { Panel, PendingNavigation } from './app/types';
import Toast from './components/feedback/Toast';
import WorkspaceShell from './components/layout/WorkspaceShell';
import { ArticleActionSheet, ArticleToolbar, DocumentView, Editor, UnsavedChangesPrompt } from './features/reader/ReaderViews';
import RepositorySettings from './features/settings/RepositorySettings';
import SyncPanel from './features/sync/SyncPanel';
import { ConnectGitHub, InitializationProgress, RepositoryPicker, SetupScreen } from './features/setup/SetupScreens';
import { displayName, isMarkdown } from './lib/files';

const ArticleEditor = lazy(() => import('./features/reader/ArticleEditor'));

export default function App() {
  const route = useAppRoute();
  const panel = panelForRoute(route.pathname);
  const workspace = useWorkspaceController();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openExplorerOnReturn, setOpenExplorerOnReturn] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  const requestNavigation = useCallback((label: string, proceed: () => void) => {
    if (workspace.hasUnsavedChanges) {
      setPendingNavigation({ label, proceed });
      return;
    }
    proceed();
  }, [workspace.hasUnsavedChanges]);

  const navigateToPanel = useCallback((nextPanel: Panel) => {
    const nextPath = pathForPanel(nextPanel);
    const label = nextPanel === 'sync' ? '打开同步状态' : nextPanel === 'settings' ? '打开设置' : '返回笔记库';
    requestNavigation(label, () => {
      if (nextPanel !== 'vault') workspace.resetEditor();
      setDrawerOpen(false);
      navigate(nextPath);
    });
  }, [requestNavigation, workspace.resetEditor]);

  const closeSettingsToExplorer = useCallback(() => {
    requestNavigation('返回笔记库', () => {
      workspace.resetEditor();
      setOpenExplorerOnReturn(true);
      navigate('/');
    });
  }, [requestNavigation, workspace.resetEditor]);

  const openFile = useCallback((file: NoteSummary) => {
    requestNavigation(`打开「${displayName(file.path)}」`, () => {
      setDrawerOpen(false);
      navigate('/');
      void workspace.loadFile(file);
    });
  }, [requestNavigation, workspace.loadFile]);

  const openNew = useCallback(() => {
    requestNavigation('新建笔记', () => {
      setDrawerOpen(false);
      navigate('/');
      workspace.createDraft();
    });
  }, [requestNavigation, workspace.createDraft]);

  const openDocumentPath = useCallback((path: string) => {
    const file = workspace.files.find((item) => item.path === path);
    if (file) openFile(file);
  }, [openFile, workspace.files]);

  useEffect(() => {
    if (route.pathname !== '/') workspace.resetEditor();
    setDrawerOpen(false);
  }, [route.pathname, workspace.resetEditor]);

  useEffect(() => {
    if (!openExplorerOnReturn || route.pathname !== '/') return;
    setDrawerOpen(true);
    setOpenExplorerOnReturn(false);
  }, [openExplorerOnReturn, route.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('github') === 'connected') {
      void workspace.reload(false);
      workspace.setNotice('GitHub 已连接，请选择要同步的笔记库。');
    }
    if (params.get('github') === 'error') workspace.setError(params.get('reason') || 'GitHub 授权没有完成。');
    if (params.has('github')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('github');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [workspace.reload, workspace.setError, workspace.setNotice]);

  const closeError = useCallback(() => workspace.setError(null), [workspace.setError]);
  const closeNotice = useCallback(() => workspace.setNotice(null), [workspace.setNotice]);
  const feedback = workspace.error
    ? <Toast key={`error:${workspace.error}`} kind="error" value={workspace.error} onClose={closeError} />
    : workspace.notice ? <Toast key={`notice:${workspace.notice}`} kind="notice" value={workspace.notice} onClose={closeNotice} /> : null;

  if (workspace.loading && !workspace.auth) return <SetupScreen><LoaderCircle className="spin" size={21} />正在读取本地设置</SetupScreen>;
  if (!workspace.auth?.authenticated) return <SetupScreen feedback={feedback}><ConnectGitHub error={workspace.error} /></SetupScreen>;
  if (!workspace.repository) return <SetupScreen feedback={feedback}><RepositoryPicker login={workspace.auth.login} onSelect={workspace.chooseRepository} /></SetupScreen>;
  if (workspace.sync?.state === 'initializing' && workspace.sync) return <SetupScreen feedback={feedback}><InitializationProgress sync={workspace.sync} onRetry={workspace.runSync} /></SetupScreen>;

  const explorer = {
    files: workspace.files,
    selectedPath: workspace.selected?.path,
    expanded: workspace.expanded,
    search: workspace.search,
    sync: workspace.sync,
    panel,
    onSearch: workspace.setSearch,
    onToggle: workspace.toggleFolder,
    onCollapseAll: workspace.collapseAllFolders,
    onSelect: openFile,
    onPanel: navigateToPanel,
    onSync: workspace.runSync,
  };

  const editingArticle = workspace.draft && workspace.note && workspace.selected
    ? { draft: workspace.draft, note: workspace.note, selected: workspace.selected }
    : null;
  const vaultContent = editingArticle
    ? workspace.articleMode === 'write'
      ? <Suspense fallback={<div className="document-loading" role="status"><LoaderCircle className="spin" size={20} /></div>}><ArticleEditor draft={editingArticle.draft} readerFontSize={workspace.clientSettings.readerFontSize} sourcePath={editingArticle.selected.path} files={workspace.files} onChange={(content) => workspace.setDraft((current) => current ? { ...current, content } : current)} onSave={() => void workspace.saveDraft()} /></Suspense>
      : <DocumentView selected={editingArticle.selected} note={{ ...editingArticle.note, content: editingArticle.draft.content }} files={workspace.files} loading={workspace.loading || workspace.loadingFile} readerFontSize={workspace.clientSettings.readerFontSize} onOpen={openDocumentPath} onNew={openNew} />
    : workspace.draft
      ? <Editor draft={workspace.draft} onChange={workspace.setDraft} onSave={() => void workspace.saveDraft()} onDelete={workspace.deleteDraft} onCancel={() => workspace.setDraft(null)} />
      : <DocumentView selected={workspace.selected} note={workspace.note} files={workspace.files} loading={workspace.loading || workspace.loadingFile} readerFontSize={workspace.clientSettings.readerFontSize} onOpen={openDocumentPath} onNew={openNew} />;

  const content = panel === 'vault' ? vaultContent
    : panel === 'sync' ? <SyncPanel sync={workspace.sync} onSync={workspace.runSync} onRefresh={() => void workspace.reload(false)} onError={workspace.setError} />
      : <RepositorySettings repository={workspace.repository} auth={workspace.auth} readerFontSize={workspace.clientSettings.readerFontSize} onReaderFontSizeChange={workspace.setReaderFontSize} onClearReadingCache={workspace.clearReadingCache} onDisconnect={workspace.disconnect} onClose={closeSettingsToExplorer} />;

  const pendingPrompt = pendingNavigation && <UnsavedChangesPrompt
    label={pendingNavigation.label}
    onCancel={() => setPendingNavigation(null)}
    onDiscard={() => {
      const next = pendingNavigation;
      setPendingNavigation(null);
      workspace.resetEditor();
      next.proceed();
    }}
    onSave={() => void workspace.saveDraft().then((saved) => {
      if (!saved) return;
      const next = pendingNavigation;
      setPendingNavigation(null);
      next.proceed();
    })}
  />;

  return <WorkspaceShell
    explorer={explorer}
    drawerOpen={drawerOpen}
    onDrawerOpen={() => setDrawerOpen(true)}
    onDrawerClose={() => setDrawerOpen(false)}
    showMobileMenu={panel !== 'settings'}
    feedback={feedback}
    toolbar={panel === 'vault' && workspace.note && isMarkdown(workspace.selected?.path ?? '') ? <ArticleToolbar articleMode={workspace.articleMode} refreshState={workspace.documentRefresh} onToggle={() => void workspace.changeArticleMode(workspace.articleMode === 'read' ? 'write' : 'read')} onOpenMenu={() => workspace.setSheetOpen(true)} onRetry={workspace.retryDocumentUpdate} /> : null}
  >
    {content}
    {workspace.sheetOpen && workspace.note && <ArticleActionSheet mode={workspace.articleMode} onClose={() => workspace.setSheetOpen(false)} onModeChange={(mode) => void workspace.changeArticleMode(mode)} onCopy={() => void workspace.copyArticle()} onFavorite={() => { workspace.setSheetOpen(false); workspace.setNotice('收藏功能即将支持。'); }} onDelete={() => void workspace.deleteCurrentArticle()} />}
    {pendingPrompt}
  </WorkspaceShell>;
}
