import type { CSSProperties } from 'react';
import type { NoteSummary } from '../../api';
import MarkdownLiveEditor from '../../components/MarkdownLiveEditor';
import type { Draft } from '../../app/types';
import { splitArticle } from '../../lib/article';
import { displayName } from '../../lib/files';

export default function ArticleEditor({ draft, readerFontSize, sourcePath, files, onChange, onSave }: { draft: Draft; readerFontSize: number; sourcePath: string; files: NoteSummary[]; onChange: (content: string) => void; onSave: () => void }) {
  const article = splitArticle(draft.content, sourcePath);
  const hasTitle = /^\uFEFF?\s*#\s+/.test(draft.content);
  const updateContent = (title: string, body: string, forceTitle = hasTitle) => {
    const nextTitle = title.replace(/\s+/g, ' ').trim() || displayName(sourcePath);
    onChange(forceTitle || nextTitle !== displayName(sourcePath) ? `# ${nextTitle}${body ? `\n\n${body}` : '\n'}` : body);
  };

  return <article className="document-view reader-document article-editor-view" style={{ '--reader-font-size': `${readerFontSize}px` } as CSSProperties}>
    <header className="article-header"><h1 className="fallback-title article-title article-title-editor" contentEditable suppressContentEditableWarning role="textbox" inputMode="text" aria-label="文章标题" aria-multiline="false" onInput={(event) => updateContent(event.currentTarget.textContent ?? '', article.body, true)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}>{article.title}</h1></header>
    <MarkdownLiveEditor content={article.body} sourcePath={sourcePath} files={files} onChange={(body) => updateContent(article.title, body)} onSave={onSave} />
    <small className="article-editor-hint">点击任意段落编辑；当前行显示 Markdown 语法；⌘S 保存</small>
  </article>;
}
