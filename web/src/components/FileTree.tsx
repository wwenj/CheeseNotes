import { memo, useMemo } from 'react';
import { ChevronRight, File, FileAudio, FileCode2, FileImage, FileText, FileVideo, Folder, FolderOpen } from 'lucide-react';
import type { NoteSummary } from '../api';
import { buildTree, displayName, fileKind, folderPaths, treeTitle, type TreeNode } from '../lib/files';

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
  if (!node.folder) return <button className={`file-tree-file ${selectedPath === node.path ? 'is-active' : ''}`} style={{ paddingInlineStart: 13 + depth * 15 }} onClick={() => node.file && onSelect(node.file)}><IconForFile path={node.path} /><span>{node.file ? treeTitle(node.file) : displayName(node.path)}</span></button>;
  const open = expanded.has(node.path);
  return <div className="file-tree-folder"><button className="file-tree-folder-button" style={{ paddingInlineStart: 10 + depth * 15 }} onClick={() => onToggle(node.path)} aria-expanded={open}><ChevronRight className={open ? 'is-open' : ''} size={15} /><span className="folder-icon">{open ? <FolderOpen size={16} /> : <Folder size={16} />}</span><span>{node.name}</span></button>{open && <div>{node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} expanded={expanded} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} />)}</div>}</div>;
}

function FileTree({ files, folders, selectedPath, expanded, search, searchOpen, onToggle, onSelect, onRevealFolder }: { files: NoteSummary[]; folders: string[]; selectedPath?: string; expanded: Set<string>; search: string; searchOpen: boolean; onToggle: (path: string) => void; onSelect: (file: NoteSummary) => void; onRevealFolder: (path: string) => void }) {
  const query = search.trim().toLowerCase();
  const matches = useMemo(() => query ? files.filter((file) => `${file.path}\n${file.title ?? ''}`.toLowerCase().includes(query)) : [], [files, query]);
  const allFolders = useMemo(() => folderPaths(files, folders), [files, folders]);
  const folderMatches = useMemo(() => query ? allFolders.filter((folder) => folder.toLowerCase().includes(query)) : [], [allFolders, query]);
  const tree = useMemo(() => buildTree(files, folders), [files, folders]);
  const searching = searchOpen && Boolean(query);
  return <div className="file-explorer"><div className="tree-scroll">{searching ? <div className="tree-matches">{folderMatches.map((folder) => <button key={folder} type="button" className="file-tree-file file-tree-search-result" onClick={() => onRevealFolder(folder)}><Folder size={16} /><span className="file-tree-search-copy"><strong>{displayName(folder)}</strong><small>{folder}</small></span></button>)}{matches.map((file) => <button key={file.path} className={`file-tree-file file-tree-search-result ${selectedPath === file.path ? 'is-active' : ''}`} onClick={() => onSelect(file)}><IconForFile path={file.path} /><span className="file-tree-search-copy"><strong>{treeTitle(file)}</strong><small>{file.path}</small></span></button>)}{!matches.length && !folderMatches.length && <p>没有匹配的文件或文件夹</p>}</div> : tree.map((node) => <TreeItem key={node.path} node={node} depth={0} expanded={expanded} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} />)}</div></div>;
}

export default memo(FileTree);
