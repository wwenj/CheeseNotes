import { memo, useRef, useState, type CSSProperties } from 'react';
import type { NoteSummary } from '../../api';
import MarkdownLiveEditor from '../../components/MarkdownLiveEditor';
import type { Draft } from '../../app/types';
import { splitArticle } from '../../lib/article';
import { displayName } from '../../lib/files';

function ArticleEditor({ draft, readerFontSize, sourcePath, files, onChange, onSave }: { draft: Draft; readerFontSize: number; sourcePath: string; files: NoteSummary[]; onChange: (content: string) => void; onSave: () => void }) {
  const article = splitArticle(draft.content, sourcePath);
  const hasTitle = /^\uFEFF?\s*#\s+/.test(draft.content);
  const [title, setTitle] = useState(article.title);
  const composingTitle = useRef(false);
  const updateContent = (title: string, body: string, forceTitle = hasTitle) => {
    const nextTitle = title.trim() ? title : displayName(sourcePath);
    onChange(forceTitle || nextTitle !== displayName(sourcePath) ? `# ${nextTitle}${body ? `\n\n${body}` : '\n'}` : body);
  };

  return <article className="document-view reader-document article-editor-view" style={{ '--reader-font-size': `${readerFontSize}px` } as CSSProperties}>
    <header className="article-header"><input className="fallback-title article-title article-title-editor" value={title} aria-label="文章标题" onChange={(event) => {
      const nextTitle = event.currentTarget.value;
      setTitle(nextTitle);
      if (!composingTitle.current) updateContent(nextTitle, article.body, true);
    }} onCompositionStart={() => { composingTitle.current = true; }} onCompositionEnd={(event) => {
      composingTitle.current = false;
      updateContent(event.currentTarget.value, article.body, true);
    }} /></header>
    <MarkdownLiveEditor content={article.body} sourcePath={sourcePath} files={files} onChange={(body) => updateContent(title, body)} onSave={onSave} />
  </article>;
}

export default memo(ArticleEditor);
