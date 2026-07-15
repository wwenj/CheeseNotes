import { useCallback, useEffect, useRef, useState } from 'react';
import { githubApi, notesApi, settingsApi, syncApi, type GitHubAuth, type Note, type NoteSummary, type SyncStatus } from '../api';
import { ApiError, apiUrl } from '../api/http';
import type { ArticleMode, ClientSettings, Draft } from './types';
import { clampReaderFontSize, clientSettingsKey, isSyncBusy, lastArticleKey, loadClientSettings, messageOf, newNotePath } from './constants';
import { AutoSaveQueue } from '../lib/autosave';
import { splitArticle } from '../lib/article';
import { isMarkdown, isText } from '../lib/files';
import { clearCachedAssets, clearCachedDrafts, clearCachedWorkspace, readCachedDocument, readCachedDraft, readCachedDrafts, removeCachedDocument, removeCachedDraft, setCachedLastPath, writeCachedDocument, writeCachedDraft } from '../lib/workspace-cache';

const workspaceKeyFor = (repository: string) => `${apiUrl('').replace(/\/api\/?$/, '')}::${repository}`;

type LoadOptions = { workspaceKey?: string };
type ReloadOptions = { preserveCurrentDocument?: boolean; forceTreeRefresh?: boolean };
type DocumentRefreshState = 'updating' | 'failed';

export function useWorkspaceController() {
  const [auth, setAuth] = useState<GitHubAuth | null>(null);
  const [repository, setRepository] = useState<string | null>(null);
  const [files, setFiles] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [selected, setSelected] = useState<NoteSummary | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  const articleModeRef = useRef<ArticleMode>('read');
  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const restoredDraftWorkspaces = useRef(new Set<string>());
  const autosaveRef = useRef<AutoSaveQueue | null>(null);

  if (!autosaveRef.current) {
    autosaveRef.current = new AutoSaveQueue({
      persist: (nextDraft) => writeCachedDraft(nextDraft.workspaceKey, nextDraft),
      clear: (nextDraft) => removeCachedDraft(nextDraft.workspaceKey, nextDraft.path, nextDraft.updatedAt),
      save: async (nextDraft) => {
        try {
          const result = nextDraft.revision
            ? await notesApi.update(nextDraft.path, nextDraft.content, nextDraft.revision, nextDraft.id)
            : await notesApi.create(nextDraft.path, nextDraft.content, nextDraft.id);
          return { kind: 'saved', revision: result.revision, path: result.path, id: result.id } as const;
        } catch (reason) {
          if (!(reason instanceof ApiError) || reason.status !== 409) throw reason;
          const current = await notesApi.content(nextDraft.path);
          return current.content === nextDraft.content
            ? { kind: 'saved', revision: current.revision, path: current.path, id: current.id } as const
            : { kind: 'blocked' } as const;
        }
      },
      onSaved: async (savedDraft, result) => {
        const saved = { id: result.id, path: result.path, content: savedDraft.content, revision: result.revision };
        const title = isMarkdown(saved.path) ? splitArticle(saved.content, saved.path).title : undefined;
        await writeCachedDocument(savedDraft.workspaceKey, saved);
        if (selectedRef.current?.path === savedDraft.path) selectedRef.current = { ...selectedRef.current, id: saved.id, path: saved.path, revision: saved.revision, ...(title ? { title } : {}) };
        setFiles((current) => {
          const nextFile = { id: saved.id, path: saved.path, revision: saved.revision, assetVersion: saved.revision, updated_at: new Date().toISOString(), ...(title ? { title } : {}) };
          const index = current.findIndex((file) => file.id === saved.id || file.path === savedDraft.path);
          const next = index < 0 ? [...current, nextFile] : current.map((file, itemIndex) => itemIndex === index ? { ...file, ...nextFile } : file);
          return next.sort((left, right) => left.path.localeCompare(right.path));
        });
        setNote((current) => current?.path === savedDraft.path ? saved : current);
        setDraft((current) => current?.path === savedDraft.path ? { ...current, id: saved.id, path: saved.path, revision: saved.revision } : current);
        setSelected((current) => current?.path === savedDraft.path ? { ...current, id: saved.id, path: saved.path, revision: saved.revision, ...(title ? { title } : {}) } : current);
      },
      onRetrying: () => setError('自动保存暂时失败，当前内容已保留在本机，将自动重试。'),
      onBlocked: () => setError('服务端笔记已变化，当前内容已保留在本机，自动保存会继续重试。'),
    });
  }
  const autosave = autosaveRef.current;

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { repositoryRef.current = repository; }, [repository]);
  useEffect(() => { articleModeRef.current = articleMode; }, [articleMode]);

  const restoreWorkspaceDrafts = useCallback(async (workspaceKey: string) => {
    if (restoredDraftWorkspaces.current.has(workspaceKey)) return;
    restoredDraftWorkspaces.current.add(workspaceKey);
    const cachedDrafts = await readCachedDrafts(workspaceKey);
    for (const cachedDraft of cachedDrafts) autosave.restore(cachedDraft);
  }, [autosave]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void autosave.flush();
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => document.removeEventListener('visibilitychange', flushWhenHidden);
  }, [autosave]);

  const reveal = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const parts = path.split('/');
      for (let index = 1; index < parts.length; index += 1) next.add(parts.slice(0, index).join('/'));
      return next;
    });
  }, []);

  const revealFolder = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const parts = path.split('/');
      for (let index = 1; index <= parts.length; index += 1) next.add(parts.slice(0, index).join('/'));
      return next;
    });
  }, []);

  const loadFile = useCallback(async (file: NoteSummary, options: LoadOptions = {}) => {
    const previous = selectedRef.current;
    const previousRepository = repositoryRef.current;
    if (previous && previousRepository && previous.path !== file.path) {
      void autosave.flush(workspaceKeyFor(previousRepository), previous.path);
    }
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
    let pendingDraft = workspaceKey ? autosave.draft(workspaceKey, file.path) : undefined;
    if (!pendingDraft && workspaceKey) {
      const cachedDraft = await readCachedDraft(workspaceKey, file.path);
      if (cachedDraft) {
        autosave.restore(cachedDraft);
        pendingDraft = autosave.draft(workspaceKey, file.path);
      }
    }
    if (sequence !== loadSequence.current) return;

    const showDocument = (current: Note | null) => {
      const recoveredDraft = workspaceKey ? autosave.draft(workspaceKey, file.path) ?? pendingDraft : pendingDraft;
      if (!recoveredDraft) {
        setNote(current);
        return;
      }
      const recovered = { path: file.path, content: recoveredDraft.content, revision: recoveredDraft.revision };
      setNote(current ? { ...current, content: recoveredDraft.content } : recovered);
      setDraft(recovered);
    };

    showDocument(cached ? { path: cached.path, content: cached.content, revision: cached.revision } : null);

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
      showDocument(fresh);
      const activeRevision = workspaceKey ? autosave.revision(workspaceKey, file.path) : undefined;
      if (workspaceKey && (!activeRevision || activeRevision === fresh.revision)) await writeCachedDocument(workspaceKey, fresh);
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
  }, [autosave, reveal]);

  const reload = useCallback(async (withLoading = true, options: ReloadOptions = {}) => {
    if (withLoading) setLoading(true);
    try {
      const [nextAuth, config, nextSync] = await Promise.all([githubApi.auth(), settingsApi.repository(), syncApi.status()]);
      setAuth(nextAuth);
      setRepository(config.repository || null);
      repositoryRef.current = config.repository || null;
      setSync(nextSync);
      if (!config.repository) {
        setFiles([]);
        setFolders([]);
        setError(null);
        return;
      }

      const workspaceKey = workspaceKeyFor(config.repository);
      void restoreWorkspaceDrafts(workspaceKey);
      const nextTree = await notesApi.tree(undefined, undefined, true);
      if (nextTree.files) {
        setFiles(nextTree.files);
        setFolders(nextTree.folders ?? []);
        const current = selectedRef.current;
        const preserveCurrentDocument = options.preserveCurrentDocument || articleModeRef.current === 'write';
        if (current && !preserveCurrentDocument) {
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
        } else if (!current) {
          const lastPath = localStorage.getItem(lastArticleKey);
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
  }, [loadFile, restoreWorkspaceDrafts]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!isSyncBusy(sync)) return;
    const timer = window.setInterval(() => {
      void syncApi.status().then(async (next) => {
        setSync(next);
        if (!isSyncBusy(next)) await reload(false, { preserveCurrentDocument: true, forceTreeRefresh: true });
      }).catch((reason) => setError(messageOf(reason)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [reload, sync?.state]);

  const updateDraftContent = useCallback((content: string) => {
    setDraft((current) => {
      if (!current) return current;
      const currentRepository = repositoryRef.current;
      if (currentRepository) {
        const workspaceKey = workspaceKeyFor(currentRepository);
        const title = splitArticle(content, current.path).title.trim();
        if (!current.revision && (!title || title === '未命名')) return { ...current, content };
        autosave.update({
          workspaceKey,
          id: current.id,
          path: current.path,
          content,
          revision: autosave.revision(workspaceKey, current.path) ?? current.revision ?? '',
        });
      }
      return { ...current, content };
    });
  }, [autosave]);

  const flushCurrentDraft = useCallback(() => {
    const current = selectedRef.current;
    const currentRepository = repositoryRef.current;
    if (!current || !currentRepository) return Promise.resolve(true);
    return autosave.flush(workspaceKeyFor(currentRepository), current.path);
  }, [autosave]);

  const changeArticleMode = useCallback((nextMode: ArticleMode) => {
    if (nextMode === articleMode) {
      setSheetOpen(false);
      return;
    }
    if (nextMode === 'read') {
      const currentRepository = repositoryRef.current;
      if (selected && currentRepository) void autosave.flush(workspaceKeyFor(currentRepository), selected.path);
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
    const nextDraft = draft ?? { path: selected.path, content: note.content, revision: note.revision };
    if (!draft) setDraft(nextDraft);
    const currentRepository = repositoryRef.current;
    if (currentRepository) autosave.ensure({
      workspaceKey: workspaceKeyFor(currentRepository),
      path: nextDraft.path,
      content: nextDraft.content,
      revision: nextDraft.revision ?? note.revision,
    });
    setArticleMode(nextMode);
    setSheetOpen(false);
  }, [articleMode, autosave, documentRefresh?.state, draft, note, selected]);

  const retryDocumentUpdate = useCallback(() => {
    const current = selectedRef.current;
    if (!current || !isText(current.path)) return;
    setError(null);
    void loadFile(current);
  }, [loadFile]);

  const createNote = useCallback(async () => {
    const current = selectedRef.current;
    const currentRepository = repositoryRef.current;
    if (current && currentRepository) void autosave.flush(workspaceKeyFor(currentRepository), current.path);
    loadAbort.current?.abort();
    const path = newNotePath(files.map((file) => file.path));
    const content = '# 未命名\n';
    const selected = { path, revision: '' };
    const note = { path, content, revision: '' };
    selectedRef.current = selected;
    setSelected(selected);
    setNote(note);
    setDraft(note);
    setArticleMode('write');
    setSheetOpen(false);
    setNotice('已新建本地草稿，输入标题后会自动保存并同步。');
    return true;
  }, [autosave, files, reload]);

  const createFolder = useCallback(async (path: string) => {
    try {
      const folder = await notesApi.createFolder(path);
      await reload(false);
      revealFolder(folder.path);
      setNotice('文件夹已创建。');
      return true;
    } catch (reason) {
      setError(messageOf(reason));
      return false;
    }
  }, [reload, revealFolder]);

  const resetEditor = useCallback(() => {
    const current = selectedRef.current;
    const currentRepository = repositoryRef.current;
    if (current && currentRepository) void autosave.flush(workspaceKeyFor(currentRepository), current.path);
    setDraft(null);
    setArticleMode('read');
    setSheetOpen(false);
  }, [autosave]);

  const runSync = useCallback(async () => {
    try {
      const next = await syncApi.run();
      setSync(next);
      if (!isSyncBusy(next)) await reload(false, { preserveCurrentDocument: true, forceTreeRefresh: true });
      setNotice('已开始同步。');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [reload]);

  const chooseRepository = useCallback(async (value: string) => {
    const previousRepository = repositoryRef.current;
    if (previousRepository) {
      await autosave.flush(workspaceKeyFor(previousRepository));
      autosave.stopWorkspace(workspaceKeyFor(previousRepository));
    }
    try {
      const result = await settingsApi.saveRepository(value);
      setRepository(result.repository);
      repositoryRef.current = result.repository;
      setSync(result.sync);
      setFiles([]);
      setFolders([]);
      selectedRef.current = null;
      setSelected(null);
      setNote(null);
      setDraft(null);
      setNotice('仓库已选定，正在下载当前分支。');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [autosave]);

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
      if (currentRepository) {
        const workspaceKey = workspaceKeyFor(currentRepository);
        autosave.stopWorkspace(workspaceKey);
        await Promise.all([clearCachedWorkspace(workspaceKey), clearCachedDrafts(workspaceKey)]);
      }
      await clearCachedAssets();
      setNotice('已断开 GitHub，并清除了当前服务同步的本机内容和阅读缓存。');
      await reload(false);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [autosave, reload]);

  const deleteCurrentArticle = useCallback(async () => {
    if (!selected || !note || !window.confirm(`删除「${selected.path}」？`)) return;
    try {
      const workspaceKey = repositoryRef.current ? workspaceKeyFor(repositoryRef.current) : null;
      if (workspaceKey) {
        const saved = await autosave.flush(workspaceKey, selected.path);
        if (!saved) return;
        const revision = autosave.revision(workspaceKey, selected.path) ?? note.revision;
        autosave.stop(workspaceKey, selected.path);
        await notesApi.remove(selected.path, revision, selected.id);
        await Promise.all([removeCachedDocument(workspaceKey, selected.path), removeCachedDraft(workspaceKey, selected.path)]);
      } else {
        await notesApi.remove(selected.path, note.revision, selected.id);
      }
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
  }, [autosave, note, reload, selected]);

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

  const expandAllFolders = useCallback((paths: string[]) => {
    setExpanded(new Set(paths));
  }, []);

  return {
    auth,
    repository,
    files,
    folders,
    selected,
    note,
    draft,
    expanded,
    sync,
    setSync,
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
    reload,
    loadFile,
    retryDocumentUpdate,
    updateDraftContent,
    flushCurrentDraft,
    createNote,
    createFolder,
    resetEditor,
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
    expandAllFolders,
    revealFolder,
  };
}
