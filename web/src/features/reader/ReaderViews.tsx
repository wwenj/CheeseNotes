import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { BookOpen, Check, Copy, FilePlus2, FolderOpen, Heart, LoaderCircle, MoreHorizontal, PencilLine, Trash2, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Note, NoteSummary } from '../../api';
import { displayName, isMarkdown, isText } from '../../lib/files';
import { splitArticle } from '../../lib/article';
import AssetViewer from '../../components/AssetViewer';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import type { ArticleMode, Draft } from '../../app/types';

type DocumentViewProps = {
  selected: NoteSummary | null;
  note: Note | null;
  files: NoteSummary[];
  loading: boolean;
  readerFontSize: number;
  onOpen: (path: string) => void;
  onNew: () => void;
};

export const DocumentView = memo(function DocumentView({ selected, note, files, loading, readerFontSize, onOpen, onNew }: DocumentViewProps) {
  if (!selected && !loading) return <div className="document-empty"><div><FolderOpen size={27} /><h1>打开一个文件</h1><p>从文件列表选择笔记、PDF 或其他附件。</p><button type="button" className="accent-button" onClick={onNew}><FilePlus2 size={16} />新建笔记</button></div></div>;
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

export function UnsavedChangesPrompt({ label, onCancel, onDiscard, onSave }: { label: string; onCancel: () => void; onDiscard: () => void; onSave: () => void }) {
  return <div className="unsaved-prompt" role="alertdialog" aria-modal="true" aria-label="未保存修改"><strong>有未保存的修改</strong><span>继续{label}前，请先处理当前文章。</span><div><button type="button" className="quiet-action" onClick={onCancel}>继续编辑</button><button type="button" className="quiet-action" onClick={onDiscard}>放弃</button><button type="button" className="accent-button" onClick={onSave}>保存并继续</button></div></div>;
}

export function Editor({ draft, onChange, onSave, onDelete, onCancel }: { draft: Draft; onChange: (draft: Draft) => void; onSave: () => void; onDelete: () => void; onCancel: () => void }) {
  return <section className="editor-view"><header className="editor-header"><span>{draft.revision ? '编辑笔记' : '新建笔记'}</span><div>{draft.revision && <button type="button" className="delete-action" onClick={onDelete}><Trash2 size={15} />删除</button>}<button type="button" className="quiet-action" onClick={onCancel}>取消</button><button type="button" className="accent-button" onClick={onSave}><Check size={16} />保存</button></div></header><label className="path-field">路径<input value={draft.path} onChange={(event) => onChange({ ...draft, path: event.target.value })} autoFocus /></label><textarea className="source-editor" value={draft.content} onChange={(event) => onChange({ ...draft, content: event.target.value })} spellCheck="false" /></section>;
}
