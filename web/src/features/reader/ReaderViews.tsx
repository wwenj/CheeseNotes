import type { CSSProperties } from 'react';
import { BookOpen, Check, Copy, FilePlus2, FolderOpen, Heart, LoaderCircle, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Note, NoteSummary } from '../../api';
import { displayName, isMarkdown, isText } from '../../lib/files';
import { splitArticle } from '../../lib/article';
import AssetViewer from '../../components/AssetViewer';
import MarkdownLiveEditor from '../../components/MarkdownLiveEditor';
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

export function DocumentView({ selected, note, files, loading, readerFontSize, onOpen, onNew }: DocumentViewProps) {
  if (!selected && !loading) return <div className="document-empty"><div><FolderOpen size={27} /><h1>打开一个文件</h1><p>从文件列表选择笔记、PDF 或其他附件。</p><button type="button" className="accent-button" onClick={onNew}><FilePlus2 size={16} />新建笔记</button></div></div>;
  if (loading) return <div className="document-loading"><LoaderCircle className="spin" size={20} />正在打开文件</div>;
  if (!selected) return null;
  if (isMarkdown(selected.path) && note) {
    const article = splitArticle(note.content, selected.path);
    return <article className="document-view reader-document" style={{ '--reader-font-size': `${readerFontSize}px` } as CSSProperties}>
      <h1 className="fallback-title article-title">{article.title}</h1>
      {article.body.trim() ? <MarkdownRenderer content={article.body} sourcePath={selected.path} files={files} onOpen={onOpen} /> : null}
    </article>;
  }
  return <article className="document-view"><h1 className="fallback-title">{displayName(selected.path)}</h1>{isText(selected.path) && note ? <pre className="plain-text-view">{note.content}</pre> : <AssetViewer path={selected.path} />}</article>;
}

export function ArticleEditor({ draft, readerFontSize, sourcePath, files, onChange, onSave }: { draft: Draft; readerFontSize: number; sourcePath: string; files: NoteSummary[]; onChange: (content: string) => void; onSave: () => void }) {
  const article = splitArticle(draft.content, sourcePath);
  const hasTitle = /^\uFEFF?\s*#\s+/.test(draft.content);
  const updateContent = (title: string, body: string, forceTitle = hasTitle) => {
    const nextTitle = title.replace(/\s+/g, ' ').trim() || displayName(sourcePath);
    onChange(forceTitle || nextTitle !== displayName(sourcePath) ? `# ${nextTitle}${body ? `\n\n${body}` : '\n'}` : body);
  };

  return <article className="document-view reader-document article-editor-view" style={{ '--reader-font-size': `${readerFontSize}px` } as CSSProperties}>
    <h1 className="fallback-title article-title article-title-editor" contentEditable suppressContentEditableWarning role="textbox" inputMode="text" aria-label="文章标题" aria-multiline="false" onInput={(event) => updateContent(event.currentTarget.textContent ?? '', article.body, true)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}>{article.title}</h1>
    <MarkdownLiveEditor content={article.body} sourcePath={sourcePath} files={files} onChange={(body) => updateContent(article.title, body)} onSave={onSave} />
    <small className="article-editor-hint">点击任意段落编辑；当前行显示 Markdown 语法；⌘S 保存</small>
  </article>;
}

export function ArticleToolbar({ articleMode, onToggle, onOpenMenu }: { articleMode: ArticleMode; onToggle: () => void; onOpenMenu: () => void }) {
  return <div className="article-toolbar">
    <button type="button" className="floating-button mode-toggle" onClick={onToggle} aria-label={articleMode === 'read' ? '切换到写作模式' : '切换到阅读模式'}>{articleMode === 'read' ? <PencilLine size={24} /> : <BookOpen size={24} />}</button>
    <button type="button" className="floating-button article-menu" onClick={onOpenMenu} aria-label="打开文章操作"><MoreHorizontal size={25} /></button>
  </div>;
}

export function ArticleActionSheet({ mode, onClose, onModeChange, onCopy, onFavorite, onDelete }: { mode: ArticleMode; onClose: () => void; onModeChange: (mode: ArticleMode) => void; onCopy: () => void; onFavorite: () => void; onDelete: () => void }) {
  const modes: Array<{ mode: ArticleMode; label: string; icon: LucideIcon }> = [
    { mode: 'read', label: '阅读视图', icon: BookOpen },
    { mode: 'write', label: '写作视图', icon: PencilLine },
  ];
  return <><button type="button" className="sheet-backdrop" aria-label="关闭文章操作" onClick={onClose} /><section className="article-action-sheet" role="dialog" aria-modal="true" aria-label="文章操作">
    <div className="sheet-handle" />
    <div className="sheet-group sheet-mode-group">{modes.map(({ mode: itemMode, label, icon: Icon }) => <button type="button" key={itemMode} className={mode === itemMode ? 'sheet-row is-active' : 'sheet-row'} onClick={() => onModeChange(itemMode)}><Icon size={18} /><span>{label}</span>{mode === itemMode && <Check size={16} />}</button>)}</div>
    <div className="sheet-group"><button type="button" className="sheet-row" onClick={onCopy}><Copy size={18} /><span>复制文章</span></button><button type="button" className="sheet-row" onClick={onFavorite}><Heart size={18} /><span>收藏</span><small>即将支持</small></button></div>
    <div className="sheet-group"><button type="button" className="sheet-row sheet-danger" onClick={onDelete}><Trash2 size={18} /><span>删除文章</span></button></div>
  </section></>;
}

export function UnsavedChangesPrompt({ label, onCancel, onDiscard, onSave }: { label: string; onCancel: () => void; onDiscard: () => void; onSave: () => void }) {
  return <div className="unsaved-prompt" role="alertdialog" aria-modal="true" aria-label="未保存修改"><strong>有未保存的修改</strong><span>继续{label}前，请先处理当前文章。</span><div><button type="button" className="quiet-action" onClick={onCancel}>继续编辑</button><button type="button" className="quiet-action" onClick={onDiscard}>放弃</button><button type="button" className="accent-button" onClick={onSave}>保存并继续</button></div></div>;
}

export function Editor({ draft, onChange, onSave, onDelete, onCancel }: { draft: Draft; onChange: (draft: Draft) => void; onSave: () => void; onDelete: () => void; onCancel: () => void }) {
  return <section className="editor-view"><header className="editor-header"><span>{draft.revision ? '编辑笔记' : '新建笔记'}</span><div>{draft.revision && <button type="button" className="delete-action" onClick={onDelete}><Trash2 size={15} />删除</button>}<button type="button" className="quiet-action" onClick={onCancel}>取消</button><button type="button" className="accent-button" onClick={onSave}><Check size={16} />保存</button></div></header><label className="path-field">路径<input value={draft.path} onChange={(event) => onChange({ ...draft, path: event.target.value })} autoFocus /></label><textarea className="source-editor" value={draft.content} onChange={(event) => onChange({ ...draft, content: event.target.value })} spellCheck="false" /></section>;
}
