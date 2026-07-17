import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowUpRight, BookOpen, Check, CircleAlert, CircleCheckBig, Copy, FilePlus2, FileText, Heart, LoaderCircle, MoreHorizontal, PencilLine, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Note, NoteSummary, SyncStatus } from '../../api';
import { formatLastSync, isSyncBusy, stateText } from '../../app/constants';
import { displayName, isMarkdown, isText, treeTitle } from '../../lib/files';
import { splitArticle } from '../../lib/article';
import AssetViewer from '../../components/AssetViewer';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import type { ArticleMode } from '../../app/types';

type DocumentViewProps = {
  selected: NoteSummary | null;
  note: Note | null;
  files: NoteSummary[];
  recentArticles?: NoteSummary[];
  sync?: SyncStatus | null;
  loading: boolean;
  readerFontSize: number;
  onOpen: (path: string) => void;
  onNew: () => void;
};

function WelcomeView({ files, recentArticles, sync, onOpen, onNew }: Pick<DocumentViewProps, 'files' | 'recentArticles' | 'sync' | 'onOpen' | 'onNew'>) {
  const noteCount = files.filter((file) => isMarkdown(file.path)).length;
  const conflict = sync?.syncBlockedByConflicts || sync?.state === 'conflict';
  const syncing = isSyncBusy(sync ?? null);
  const syncLabel = conflict ? `${sync?.conflictCount ?? 0} 个冲突待处理` : stateText[sync?.state ?? 'unconfigured'];
  const syncDetail = conflict ? '请在同步页处理' : formatLastSync(sync?.lastSuccessAt ?? '');
  const SyncIcon = conflict ? CircleAlert : syncing ? RefreshCw : CircleCheckBig;
  const recentNotes = recentArticles?.slice(0, 5) ?? [];

  return <section className="welcome-view" aria-labelledby="welcome-title">
    <div className="welcome-surface">
      <header className="welcome-summary">
        <div className="welcome-intro">
          <div className="welcome-brand"><img src="/images/cheese-logo.png" alt="" /><strong>芝士</strong></div>
          <h1 id="welcome-title">芝士，就是力量</h1>
          <button type="button" className="accent-button" onClick={onNew}><FilePlus2 size={16} />新建笔记</button>
        </div>
        <dl className="welcome-stats">
          <div><dt>笔记</dt><dd>{noteCount}<small>篇</small></dd></div>
          <div className={`welcome-sync ${conflict ? 'is-conflict' : sync?.state === 'failed' ? 'is-failed' : syncing ? 'is-busy' : 'is-ready'}`}>
            <dt>同步</dt><dd><SyncIcon className={syncing ? 'spin' : ''} size={16} /><span>{syncLabel}</span></dd><small>{syncDetail}</small>
          </div>
        </dl>
      </header>
      {recentNotes.length > 0 && <section className="welcome-recent" aria-label="最近访问的笔记">
        <div className="welcome-recent-heading">最近阅读</div>
        <div className="welcome-recent-list">{recentNotes.map((file) => <button type="button" key={file.path} className="welcome-note" onClick={() => onOpen(file.path)}>
          <FileText size={17} /><span><strong>{treeTitle(file)}</strong></span><ArrowUpRight size={16} />
        </button>)}</div>
      </section>}
    </div>
  </section>;
}

export const DocumentView = memo(function DocumentView({ selected, note, files, recentArticles, sync, loading, readerFontSize, onOpen, onNew }: DocumentViewProps) {
  if (!selected && !loading) return <WelcomeView files={files} recentArticles={recentArticles} sync={sync} onOpen={onOpen} onNew={onNew} />;
  if (loading && !note) return <div className="document-loading" role="status" aria-label="正在加载"><LoaderCircle className="spin" size={20} /></div>;
  if (!selected) return null;
  if (isMarkdown(selected.path) && note) {
    const article = splitArticle(note.content, selected.path);
    return <article className="document-view reader-document" style={{ '--reader-font-size': `${readerFontSize}px` } as CSSProperties}>
      <header className="article-header"><h1 className="fallback-title article-title">{article.title}</h1></header>
      {article.body.trim() ? <MarkdownRenderer content={article.body} sourcePath={selected.path} files={files} onOpen={onOpen} /> : null}
    </article>;
  }
  return <article className="document-view"><h1 className="fallback-title">{displayName(selected.path)}</h1>{isText(selected.path) && note ? <pre className="plain-text-view">{note.content}</pre> : <AssetViewer path={selected.path} version={selected.assetVersion} />}</article>;
});

export function ArticleToolbar({ articleMode, refreshState, onToggle, onOpenMenu, onRetry }: { articleMode: ArticleMode; refreshState: 'updating' | 'failed' | null; onToggle: () => void; onOpenMenu: () => void; onRetry: () => void }) {
  const [failureOpen, setFailureOpen] = useState(false);
  const updating = refreshState === 'updating';

  useEffect(() => {
    if (refreshState !== 'failed') setFailureOpen(false);
  }, [refreshState]);

  return <div className="article-toolbar">
    <button type="button" className="floating-button mode-toggle" onClick={onToggle} disabled={updating} title={updating ? '文档正在更新' : undefined} aria-label={updating ? '文档正在更新，暂不能切换写作模式' : articleMode === 'read' ? '切换到写作模式' : '切换到阅读模式'}>{articleMode === 'read' ? <PencilLine size={24} /> : <BookOpen size={24} />}</button>
    {updating && <span className="article-refresh-status" role="status" aria-live="polite" aria-label="正在更新文档"><LoaderCircle className="spin" size={18} /></span>}
    {refreshState === 'failed' && <div className="article-refresh-failure">
      <button type="button" className="floating-button article-refresh-failure-button" onClick={() => setFailureOpen((open) => !open)} aria-label="文档更新失败，点击查看提示" aria-expanded={failureOpen}><TriangleAlert size={19} /></button>
      {failureOpen && <section className="article-refresh-popover" role="dialog" aria-label="文档更新失败">
        <p>文档更新失败，请重试。</p>
        <button type="button" className="quiet-action" onClick={() => { setFailureOpen(false); onRetry(); }}>重新尝试</button>
      </section>}
    </div>}
    <button type="button" className="floating-button article-menu" onClick={onOpenMenu} aria-label="打开文章操作"><MoreHorizontal size={25} /></button>
  </div>;
}

export function ArticleActionSheet({ mode, onClose, onModeChange, onCopy, onFavorite, onDelete }: { mode: ArticleMode; onClose: () => void; onModeChange: (mode: ArticleMode) => void; onCopy: () => void; onFavorite: () => void; onDelete: () => void }) {
  const [isClosing, setIsClosing] = useState(false);
  const afterClose = useRef<(() => void) | null>(null);
  const modes: Array<{ mode: ArticleMode; label: string; icon: LucideIcon }> = [
    { mode: 'read', label: '阅读视图', icon: BookOpen },
    { mode: 'write', label: '写作视图', icon: PencilLine },
  ];

  const requestClose = useCallback((nextAction: () => void = onClose) => {
    if (isClosing) return;
    afterClose.current = nextAction;
    setIsClosing(true);
  }, [isClosing, onClose]);

  const completeClose = useCallback(() => {
    const nextAction = afterClose.current;
    afterClose.current = null;
    nextAction?.();
  }, []);

  return <><button type="button" className={isClosing ? 'sheet-backdrop is-closing' : 'sheet-backdrop'} aria-label="关闭文章操作" onClick={() => requestClose()} /><section className={isClosing ? 'article-action-sheet is-closing' : 'article-action-sheet'} role="dialog" aria-modal="true" aria-label="文章操作" onAnimationEnd={(event) => { if (isClosing && event.animationName === 'article-sheet-exit') completeClose(); }}>
    <div className="sheet-handle" />
    <div className="sheet-group sheet-mode-group">{modes.map(({ mode: itemMode, label, icon: Icon }) => <button type="button" key={itemMode} className={mode === itemMode ? 'sheet-row is-active' : 'sheet-row'} onClick={() => requestClose(() => onModeChange(itemMode))}><Icon size={18} /><span>{label}</span>{mode === itemMode && <Check size={16} />}</button>)}</div>
    <div className="sheet-group"><button type="button" className="sheet-row" onClick={() => requestClose(onCopy)}><Copy size={18} /><span>复制文章</span></button><button type="button" className="sheet-row" onClick={() => requestClose(onFavorite)}><Heart size={18} /><span>收藏</span><small>即将支持</small></button></div>
    <div className="sheet-group"><button type="button" className="sheet-row sheet-danger" onClick={() => requestClose(onDelete)}><Trash2 size={18} /><span>删除文章</span></button></div>
  </section></>;
}
