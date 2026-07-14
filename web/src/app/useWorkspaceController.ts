import { useCallback, useEffect, useState } from 'react';
import { githubApi, notesApi, settingsApi, syncApi, type GitHubAuth, type Note, type NoteSummary, type SyncStatus } from '../api';
import type { ArticleMode, ClientSettings, Draft } from './types';
import { clampReaderFontSize, clientSettingsKey, isSyncBusy, lastArticleKey, loadClientSettings, messageOf, newNotePath } from './constants';
import { hasUnsavedDraft } from '../lib/article';
import { isMarkdown, isText } from '../lib/files';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSettings, setClientSettings] = useState<ClientSettings>(loadClientSettings);
  const [articleMode, setArticleMode] = useState<ArticleMode>('read');
  const [sheetOpen, setSheetOpen] = useState(false);

  const reveal = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const parts = path.split('/');
      for (let index = 1; index < parts.length; index += 1) next.add(parts.slice(0, index).join('/'));
      return next;
    });
  }, []);

  const loadFile = useCallback(async (file: NoteSummary) => {
    setSelected(file);
    setNote(null);
    setDraft(null);
    setArticleMode('read');
    setSheetOpen(false);
    reveal(file.path);
    if (!isText(file.path)) return;
    if (isMarkdown(file.path)) localStorage.setItem(lastArticleKey, file.path);

    setLoadingFile(true);
    try {
      setNote(await notesApi.content(file.path));
      setError(null);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoadingFile(false);
    }
  }, [reveal]);

  const reload = useCallback(async (withLoading = true) => {
    if (withLoading) setLoading(true);
    try {
      const [nextAuth, config, nextSync] = await Promise.all([githubApi.auth(), settingsApi.repository(), syncApi.status()]);
      setAuth(nextAuth);
      setRepository(config.repository || null);
      setSync(nextSync);
      setFiles(config.repository ? await notesApi.tree() : []);
      setError(null);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      if (withLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (selected || draft || !files.length) return;
    const lastPath = localStorage.getItem(lastArticleKey);
    const lastArticle = lastPath ? files.find((file) => file.path === lastPath && isMarkdown(file.path)) : undefined;
    if (lastArticle) void loadFile(lastArticle);
  }, [draft, files, loadFile, selected]);

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
      setDraft(null);
      setArticleMode('read');
      await reload(false);
      await loadFile({ path: result.path });
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
    if (!note || !selected || !isMarkdown(selected.path)) return;
    if (!draft) setDraft({ path: selected.path, content: note.content, revision: note.revision });
    setArticleMode(nextMode);
    setSheetOpen(false);
  }, [articleMode, draft, note, selected]);

  const createDraft = useCallback(() => {
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
      setDraft(null);
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
      setSync(result.sync);
      setFiles([]);
      setSelected(null);
      setNote(null);
      setDraft(null);
      setNotice('仓库已选定，正在下载当前分支。');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      setAuth(await githubApi.disconnect());
      setNotice('已断开 GitHub，本地缓存和待同步修改已保留。');
      await reload(false);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [reload]);

  const deleteCurrentArticle = useCallback(async () => {
    if (!selected || !note || !window.confirm(`删除「${selected.path}」？`)) return;
    try {
      await notesApi.remove(selected.path, note.revision);
      setSheetOpen(false);
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
    saveDraft,
    createDraft,
    resetEditor,
    deleteDraft,
    runSync,
    chooseRepository,
    disconnect,
    deleteCurrentArticle,
    copyArticle,
    changeArticleMode,
    setReaderFontSize,
    toggleFolder,
  };
}
