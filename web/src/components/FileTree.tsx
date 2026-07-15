import { memo, useMemo } from 'react';
import { ChevronRight, File, FileAudio, FileCode2, FileImage, FileText, FileVideo, Folder, FolderOpen, Search, X } from 'lucide-react';
import type { NoteSummary } from '../api';
import { buildTree, displayName, fileKind, type TreeNode } from '../lib/files';

function IconForFile({ path }: { path: string }) {
  const kind = fileKind(path);
  if (kind === 'markdown') return <FileText size={16} />;
  if (kind === 'image' || kind === 'pdf') return <FileImage size={16} />;
  if (kind === 'audio') return <FileAudio size={16} />;
  if (kind === 'video') return <FileVideo size={16} />;
  if (kind === 'text') return <FileCode2 size={16} />;
  return <File size={16} />;
}

function TreeItem({ node, depth, expanded, selectedPath, onToggle, onSelect }: { node: TreeNode; depth: number; expanded: Set<string>; selectedPath?: string; onToggle: (path: string) => void; onSelect: (file: NoteSummary) => void }) {
  if (!node.folder) return <button className={`file-tree-file ${selectedPath === node.path ? 'is-active' : ''}`} style={{ paddingInlineStart: 13 + depth * 15 }} onClick={() => node.file && onSelect(node.file)}><IconForFile path={node.path} /><span>{displayName(node.path)}</span></button>;
  const open = expanded.has(node.path);
  return <div className="file-tree-folder"><button className="file-tree-folder-button" style={{ paddingInlineStart: 10 + depth * 15 }} onClick={() => onToggle(node.path)} aria-expanded={open}><ChevronRight className={open ? 'is-open' : ''} size={15} /><span className="folder-icon">{open ? <FolderOpen size={16} /> : <Folder size={16} />}</span><span>{node.name}</span></button>{open && <div>{node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} expanded={expanded} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} />)}</div>}</div>;
}

function FileTree({ files, selectedPath, expanded, search, onSearch, onToggle, onCollapseAll, onSelect }: { files: NoteSummary[]; selectedPath?: string; expanded: Set<string>; search: string; onSearch: (value: string) => void; onToggle: (path: string) => void; onCollapseAll: () => void; onSelect: (file: NoteSummary) => void }) {
  const query = search.trim().toLowerCase();
  const matches = useMemo(() => query ? files.filter((file) => file.path.toLowerCase().includes(query)) : [], [files, query]);
  const tree = useMemo(() => buildTree(files), [files]);
  return <div className="file-explorer"><div className="tree-search" role="search"><Search size={15} /><input type="text" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="筛选文件" aria-label="筛选文件" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck="false" />{search ? <button type="button" className="tree-search-clear" onClick={() => onSearch('')} aria-label="清空搜索" title="清空搜索"><X size={15} /></button> : <kbd>⌘K</kbd>}</div><div className="tree-scroll"><div className="tree-top-actions"><button type="button" className="side-action collapse-all-action" onClick={onCollapseAll} disabled={!expanded.size}>收起</button></div>{query ? <div className="tree-matches">{matches.map((file) => <button key={file.path} className={`file-tree-file file-tree-search-result ${selectedPath === file.path ? 'is-active' : ''}`} onClick={() => onSelect(file)}><IconForFile path={file.path} /><span className="file-tree-search-copy"><strong>{displayName(file.path)}</strong><small>{file.path}</small></span></button>)}{!matches.length && <p>没有匹配的文件</p>}</div> : tree.map((node) => <TreeItem key={node.path} node={node} depth={0} expanded={expanded} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} />)}</div></div>;
}

export default memo(FileTree);
