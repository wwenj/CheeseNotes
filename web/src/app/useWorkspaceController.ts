import { useCallback, useEffect, useRef, useState } from 'react';
import { githubApi, notesApi, settingsApi, syncApi, type GitHubAuth, type Note, type NoteSummary, type SyncStatus } from '../api';
import { apiUrl } from '../api/http';
import type { ArticleMode, ClientSettings, Draft } from './types';
import { clampReaderFontSize, clientSettingsKey, isSyncBusy, lastArticleKey, loadClientSettings, messageOf, newNotePath } from './constants';
import { hasUnsavedDraft } from '../lib/article';
import { isMarkdown, isText } from '../lib/files';
import { clearCachedAssets, clearCachedWorkspace, readCachedDocument, readCachedWorkspace, removeCachedDocument, setCachedLastPath, writeCachedDocument, writeCachedWorkspace } from '../lib/workspace-cache';

const workspaceKeyFor = (repository: string) => `${apiUrl('').replace(/\/api\/?$/, '')}::${repository}`;

type LoadOptions = { workspaceKey?: string };
type DocumentRefreshState = 'updating' | 'failed';

export function useWorkspaceController() {
  const [auth, setAuth] = useState<GitHubAuth | null>(null);
  const [repository, setRepository] = useState<string | null>(null);
  const [files, setFiles] = useState<NoteSummary[]>([]);
  const [selected, setSelected] = useState<NoteSummary | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [documentRefresh, setDocumentRefresh] = useState<{ path: string; state: DocumentRefreshState } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSettings, setClientSettings] = useState<ClientSettings>(loadClientSettings);
  const [articleMode, setArticleMode] = useState<ArticleMode>('read');
  const [sheetOpen, setSheetOpen] = useState(false);
  const selectedRef = useRef<NoteSummary | null>(null);
  const repositoryRef = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { repositoryRef.current = repository; }, [repository]);

  const reveal = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const parts = path.split('/');
      for (let index = 1; index < parts.length; index += 1) next.add(parts.slice(0, index).join('/'));
      return next;
    });
  }, []);

  const loadFile = useCallback(async (file: NoteSummary, options: LoadOptions = {}) => {
    const sequence = ++loadSequence.current;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setDocumentRefresh(null);
    selectedRef.current = file;
    setSelected(file);
    setDraft(null);
    setArticleMode('read');
    setSheetOpen(false);
    reveal(file.path);
    if (!isText(file.path)) {
      setNote(null);
      setLoadingFile(false);
      return;
    }

    const workspaceKey = options.workspaceKey ?? (repositoryRef.current ? workspaceKeyFor(repositoryRef.current) : null);
    if (isMarkdown(file.path)) {
      localStorage.setItem(lastArticleKey, file.path);
      if (workspaceKey) void setCachedLastPath(workspaceKey, file.path);
    }

    const cached = workspaceKey ? await readCachedDocument(workspaceKey, file.path) : undefined;
    if (sequence !== loadSequence.current) return;
    if (cached) setNote({ path: cached.path, content: cached.content, revision: cached.revision });
    else setNote(null);

    if (cached?.revision && file.revision && cached.revision === file.revision) {
      setLoadingFile(false);
      setError(null);
      return;
    }

    const needsCachedRefresh = Boolean(cached?.revision && file.revision && cached.revision !== file.revision);
    if (needsCachedRefresh) setDocumentRefresh({ path: file.path, state: 'updating' });
    setLoadingFile(true);
    try {
      const fresh = await notesApi.content(file.path, controller.signal);
      if (sequence !== loadSequence.current) return;
      setNote(fresh);
      if (workspaceKey) await writeCachedDocument(workspaceKey, fresh);
      if (cached && cached.revision !== fresh.revision) setNotice('内容已更新为最新版本。');
      setDocumentRefresh(null);
      setError(null);
    } catch (reason) {
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      if (needsCachedRefresh) {
        setDocumentRefresh({ path: file.path, state: 'failed' });
        setError('文档更新失败，当前显示的是缓存版本。');
      } else if (cached) {
        setError('文档加载失败，当前显示的是缓存版本。');
      } else {
        setError(messageOf(reason));
      }
    } finally {
      if (sequence === loadSequence.current) setLoadingFile(false);
    }
  }, [reveal]);

  const reload = useCallback(async (withLoading = true) => {
    if (withLoading) setLoading(true);
    try {
      const [nextAuth, config, nextSync] = await Promise.all([githubApi.auth(), settingsApi.repository(), syncApi.status()]);
      setAuth(nextAuth);
      setRepository(config.repository || null);
      repositoryRef.current = config.repository || null;
      setSync(nextSync);
      if (!config.repository) {
        setFiles([]);
        setError(null);
        return;
      }

      const workspaceKey = workspaceKeyFor(config.repository);
      const cachedWorkspace = await readCachedWorkspace(workspaceKey);
      if (cachedWorkspace?.files.length) {
        setFiles(cachedWorkspace.files);
        const cachedLastPath = cachedWorkspace.lastPath || localStorage.getItem(lastArticleKey);
        const cachedLast = cachedLastPath ? cachedWorkspace.files.find((file) => file.path === cachedLastPath && isMarkdown(file.path)) : undefined;
        if (!selectedRef.current && cachedLast) void loadFile(cachedLast, { workspaceKey });
      }

      const nextTree = await notesApi.tree(cachedWorkspace?.etag ?? undefined);
      if (nextTree.files) {
        setFiles(nextTree.files);
        const workspace = await writeCachedWorkspace(workspaceKey, nextTree.files, nextTree.etag);
        const current = selectedRef.current;
        if (current) {
          const refreshed = nextTree.files.find((file) => file.path === current.path);
          if (!refreshed) {
            selectedRef.current = null;
            setSelected(null);
            setNote(null);
          } else if (refreshed.revision !== current.revision || refreshed.assetVersion !== current.assetVersion) {
            void loadFile(refreshed, { workspaceKey });
          } else {
            selectedRef.current = refreshed;
            setSelected(refreshed);
          }
        } else {
          const lastPath = workspace.lastPath || localStorage.getItem(lastArticleKey);
          const lastArticle = lastPath ? nextTree.files.find((file) => file.path === lastPath && isMarkdown(file.path)) : undefined;
          if (lastArticle) void loadFile(lastArticle, { workspaceKey });
        }
      }
      setError(null);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      if (withLoading) setLoading(false);
    }
  }, [loadFile]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!isSyncBusy(sync)) return;
    const timer = window.setInterval(() => {
      void syncApi.status().then(async (next) => {
        setSync(next);
        if (!isSyncBusy(next)) await reload(false);
      }).catch((reason) => setError(messageOf(reason)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [reload, sync?.state]);

  const hasUnsavedChanges = hasUnsavedDraft(draft?.content, note?.content);

  const saveDraftData = useCallback(async (nextDraft: Draft) => {
    if (!nextDraft.path.trim() || !nextDraft.content.trim()) {
      setError('请填写笔记路径和内容。');
      return false;
    }
    try {
      const result = nextDraft.revision
        ? await notesApi.update(nextDraft.path, nextDraft.content, nextDraft.revision)
        : await notesApi.create(nextDraft.path, nextDraft.content);
      const saved = { path: result.path, content: nextDraft.content, revision: result.revision };
      const workspaceKey = repositoryRef.current ? workspaceKeyFor(repositoryRef.current) : null;
      if (workspaceKey) await writeCachedDocument(workspaceKey, saved);
      setDraft(null);
      setArticleMode('read');
      await reload(false);
      await loadFile({ path: result.path, revision: result.revision }, { workspaceKey: workspaceKey ?? undefined });
      setNotice('已保存到本机，正在同步。');
      return true;
    } catch (reason) {
      setError(messageOf(reason));
      return false;
    }
  }, [loadFile, reload]);

  const saveDraft = useCallback(() => draft ? saveDraftData(draft) : Promise.resolve(false), [draft, saveDraftData]);

  const changeArticleMode = useCallback((nextMode: ArticleMode) => {
    if (nextMode === articleMode) {
      setSheetOpen(false);
      return;
    }
    if (nextMode === 'read') {
      setArticleMode('read');
      setSheetOpen(false);
      return;
    }
    if (documentRefresh?.state === 'updating') {
      setSheetOpen(false);
      setNotice('文档正在更新，完成后可切换到写作模式。');
      return;
    }
    if (!note || !selected || !isMarkdown(selected.path)) return;
    if (!draft) setDraft({ path: selected.path, content: note.content, revision: note.revision });
    setArticleMode(nextMode);
    setSheetOpen(false);
  }, [articleMode, documentRefresh?.state, draft, note, selected]);

  const retryDocumentUpdate = useCallback(() => {
    const current = selectedRef.current;
    if (!current || !isText(current.path)) return;
    setError(null);
    void loadFile(current);
  }, [loadFile]);

  const createDraft = useCallback(() => {
    loadAbort.current?.abort();
    selectedRef.current = null;
    setSelected(null);
    setNote(null);
    setArticleMode('read');
    setSheetOpen(false);
    setDraft({ path: newNotePath(), content: '# 新笔记\n' });
  }, []);

  const resetEditor = useCallback(() => {
    setDraft(null);
    setArticleMode('read');
    setSheetOpen(false);
  }, []);

  const deleteDraft = useCallback(async () => {
    if (!draft?.revision || !window.confirm(`删除「${draft.path}」？`)) return;
    try {
      await notesApi.remove(draft.path, draft.revision);
      const workspaceKey = repositoryRef.current ? workspaceKeyFor(repositoryRef.current) : null;
      if (workspaceKey) await removeCachedDocument(workspaceKey, draft.path);
      setDraft(null);
      selectedRef.current = null;
      setSelected(null);
      setNote(null);
      await reload(false);
      setNotice('已从本机删除，正在自动同步到 GitHub。');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [draft, reload]);

  const runSync = useCallback(async () => {
    try {
      setSync(await syncApi.run());
      setNotice('已开始同步。');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, []);

  const chooseRepository = useCallback(async (value: string) => {
    try {
      const result = await settingsApi.saveRepository(value);
      setRepository(result.repository);
      repositoryRef.current = result.repository;
      setSync(result.sync);
      setFiles([]);
      selectedRef.current = null;
      setSelected(null);
      setNote(null);
      setDraft(null);
      setNotice('仓库已选定，正在下载当前分支。');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, []);

  const clearReadingCache = useCallback(async () => {
    const currentRepository = repositoryRef.current;
    if (!currentRepository) return;
    await clearCachedWorkspace(workspaceKeyFor(currentRepository));
    await clearCachedAssets();
    setNotice('已清除本地阅读缓存。');
  }, []);

  const disconnect = useCallback(async () => {
    const currentRepository = repositoryRef.current;
    try {
      setAuth(await githubApi.disconnect());
      if (currentRepository) await clearCachedWorkspace(workspaceKeyFor(currentRepository));
      await clearCachedAssets();
      setNotice('已断开 GitHub，并清除了当前服务同步的本机内容和阅读缓存。');
      await reload(false);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [reload]);

  const deleteCurrentArticle = useCallback(async () => {
    if (!selected || !note || !window.confirm(`删除「${selected.path}」？`)) return;
    try {
      await notesApi.remove(selected.path, note.revision);
      const workspaceKey = repositoryRef.current ? workspaceKeyFor(repositoryRef.current) : null;
      if (workspaceKey) await removeCachedDocument(workspaceKey, selected.path);
      setSheetOpen(false);
      selectedRef.current = null;
      setSelected(null);
      setNote(null);
      setDraft(null);
      setArticleMode('read');
      await reload(false);
      setNotice('已从本机删除，正在同步。');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [note, reload, selected]);

  const copyArticle = useCallback(async () => {
    const content = draft?.content ?? note?.content;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setSheetOpen(false);
      setNotice('文章内容已复制。');
    } catch {
      setError('复制失败，请检查浏览器权限。');
    }
  }, [draft?.content, note?.content]);

  const setReaderFontSize = useCallback((readerFontSize: number) => {
    const next = { readerFontSize: clampReaderFontSize(readerFontSize) };
    setClientSettings(next);
    localStorage.setItem(clientSettingsKey, JSON.stringify(next));
  }, []);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAllFolders = useCallback(() => {
    setExpanded(new Set());
  }, []);

  return {
    auth,
    repository,
    files,
    selected,
    note,
    draft,
    setDraft,
    expanded,
    search,
    setSearch,
    sync,
    loading,
    loadingFile,
    documentRefresh: documentRefresh && documentRefresh.path === selected?.path ? documentRefresh.state : null,
    notice,
    setNotice,
    error,
    setError,
    clientSettings,
    articleMode,
    sheetOpen,
    setSheetOpen,
    hasUnsavedChanges,
    reload,
    loadFile,
    retryDocumentUpdate,
    saveDraft,
    createDraft,
    resetEditor,
    deleteDraft,
    runSync,
    chooseRepository,
    disconnect,
    clearReadingCache,
    deleteCurrentArticle,
    copyArticle,
    changeArticleMode,
    setReaderFontSize,
    toggleFolder,
    collapseAllFolders,
  };
}
