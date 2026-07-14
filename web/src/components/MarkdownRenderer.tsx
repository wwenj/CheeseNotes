import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { notesApi, type NoteSummary } from '../api';
import { fileKind, resolveVaultPath } from '../lib/files';

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

function Embed({ raw, sourcePath, knownPaths, onOpen }: { raw: string; sourcePath: string; knownPaths: string[]; onOpen: (path: string) => void }) {
  const [target, fragment] = raw.split('#');
  const path = resolveVaultPath(target, sourcePath, knownPaths);
  if (!path) return <span className="broken-embed">找不到嵌入文件：{target}</span>;
  const url = notesApi.fileUrl(path);
  const kind = fileKind(path);
  if (kind === 'image') return <img className="markdown-image" src={url} alt={path} />;
  if (kind === 'pdf') return <iframe className="markdown-pdf" src={`${url}${fragment ? `#${fragment}` : ''}`} title={path} />;
  if (kind === 'audio') return <audio controls src={url} />;
  if (kind === 'video') return <video controls src={url} />;
  return <button className="embedded-file-link" onClick={() => onOpen(path)}><FileText size={16} />{path}</button>;
}

export default function MarkdownRenderer({ content, sourcePath, files, onOpen }: { content: string; sourcePath: string; files: NoteSummary[]; onOpen: (path: string) => void }) {
  const paths = files.map((file) => file.path);
  return <div className="markdown-view"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrl} components={{
    a: ({ href = '', children }) => {
      const raw = href.startsWith('obsidian-note:') ? decodeURIComponent(href.slice('obsidian-note:'.length)) : href;
      const path = href.startsWith('obsidian-note:') || !/^(https?:|mailto:|#)/i.test(href) ? resolveVaultPath(raw, sourcePath, paths) : null;
      if (path) return <button className="internal-link" onClick={() => onOpen(path)}>{children}</button>;
      return <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a>;
    },
    img: ({ src = '', alt = '' }) => {
      if (src.startsWith('obsidian-embed:')) return <Embed raw={decodeURIComponent(src.slice('obsidian-embed:'.length))} sourcePath={sourcePath} knownPaths={paths} onOpen={onOpen} />;
      if (/^(https?:|data:)/i.test(src)) return <img className="markdown-image" src={src} alt={alt} />;
      const path = resolveVaultPath(src, sourcePath, paths);
      return path ? <img className="markdown-image" src={notesApi.fileUrl(path)} alt={alt} /> : <span className="broken-embed">找不到图片：{src}</span>;
    },
  }}>{transformObsidianMarkdown(content)}</ReactMarkdown></div>;
}
