import { isValidElement, memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { notesApi, type NoteSummary } from '../api';
import { fileKind, resolveVaultPath } from '../lib/files';
import AssetViewer from './AssetViewer';
import CachedImage from './CachedImage';

type MarkdownRendererProps = {
  content: string;
  sourcePath: string;
  files: NoteSummary[];
  onOpen: (path: string) => void;
};

function transformObsidianMarkdown(value: string) {
  return value
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/!\[\[([^\]\n]+)\]\]/g, (_all, value: string) => {
      const target = value.split('|')[0].split('#')[0];
      return `![${target.split('/').at(-1)}](obsidian-embed:${encodeURIComponent(value)})`;
    })
    .replace(/(^|[^!])\[\[([^\]\n]+)\]\]/g, (_all, prefix: string, value: string) => {
      const [target, label] = value.split('|');
      return `${prefix}[${label || target.split('#')[0]}](obsidian-note:${encodeURIComponent(target)})`;
    })
    .replace(/^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/gm, (_all, _kind: string, title: string) => `> **${title || '提示'}**`);
}

function safeUrl(value: string) {
  return /^(https?:|mailto:|obsidian-(note|embed):|\/|#)/i.test(value) || !/^[a-z]+:/i.test(value) ? value : '';
}

function Embed({ raw, sourcePath, paths, fileByPath, onOpen }: { raw: string; sourcePath: string; paths: string[]; fileByPath: Map<string, NoteSummary>; onOpen: (path: string) => void }) {
  const [target, fragment] = raw.split('#');
  const path = resolveVaultPath(target, sourcePath, paths);
  if (!path) return <span className="broken-embed">找不到嵌入文件：{target}</span>;
  const file = fileByPath.get(path);
  const kind = fileKind(path);
  if (kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video') return <AssetViewer path={path} version={file?.assetVersion} fragment={fragment} embedded />;
  return <button className="embedded-file-link" onClick={() => onOpen(path)}><FileText size={16} />{path}</button>;
}

function MarkdownRenderer({ content, sourcePath, files, onOpen }: MarkdownRendererProps) {
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const transformedContent = useMemo(() => transformObsidianMarkdown(content), [content]);
  const components = useMemo(() => ({
    p: ({ children }: { children?: ReactNode }) => isValidElement(children) && children.type === Embed ? <>{children}</> : <p>{children}</p>,
    a: ({ href = '', children }: { href?: string; children?: ReactNode }) => {
      const raw = href.startsWith('obsidian-note:') ? decodeURIComponent(href.slice('obsidian-note:'.length)) : href;
      const path = href.startsWith('obsidian-note:') || !/^(https?:|mailto:|#)/i.test(href) ? resolveVaultPath(raw, sourcePath, paths) : null;
      if (path) return <button className="internal-link" onClick={() => onOpen(path)}>{children}</button>;
      return <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a>;
    },
    img: ({ src = '', alt = '' }: { src?: string; alt?: string }) => {
      if (src.startsWith('obsidian-embed:')) return <Embed raw={decodeURIComponent(src.slice('obsidian-embed:'.length))} sourcePath={sourcePath} paths={paths} fileByPath={fileByPath} onOpen={onOpen} />;
      if (/^(https?:|data:)/i.test(src)) return <img className="markdown-image" src={src} alt={alt} loading="lazy" decoding="async" />;
      const path = resolveVaultPath(src, sourcePath, paths);
      const file = path ? fileByPath.get(path) : undefined;
      return path ? <CachedImage className="markdown-image" src={notesApi.fileUrl(path, file?.assetVersion)} alt={alt} cache /> : <span className="broken-embed">找不到图片：{src}</span>;
    },
  }), [fileByPath, onOpen, paths, sourcePath]);

  return <div className="markdown-view"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrl} components={components}>{transformedContent}</ReactMarkdown></div>;
}

export default memo(MarkdownRenderer);
