import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Ellipsis, FileText, Folder, FolderTree, LoaderCircle, Trash2 } from 'lucide-react';
import type { ManagementTree, NoteSummary, TreeChangesResult, TreeOperation } from '../../api';
import { notesApi } from '../../api';
import { buildTree, displayName, treeTitle, type TreeNode } from '../../lib/files';
import { projectTree } from '../../lib/tree-changes';

type FileManagementProps = {
  onApply: (baseTreeVersion: string, operations: TreeOperation[]) => Promise<TreeChangesResult>;
  onClose: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

type DragItem = { type: 'file'; file: NoteSummary } | { type: 'folder'; path: string };

const basename = (path: string) => path.split('/').at(-1) || path;
const parent = (path: string) => path.split('/').slice(0, -1).join('/');
const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

type TreeItemProps = {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  dragging: DragItem | null;
  menu: string | null;
  onToggle: (path: string) => void;
  onDragStart: (item: DragItem, event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (folder: string) => void;
  onMenu: (key: string) => void;
  onDeleteFile: (file: NoteSummary) => void;
  onDeleteFolder: (path: string) => void;
};

function TreeItem({ node, depth, expanded, dragging, menu, onToggle, onDragStart, onDrop, onMenu, onDeleteFile, onDeleteFolder }: TreeItemProps) {
  const style = { paddingInlineStart: 12 + depth * 18 };
  if (!node.folder) {
    const file = node.file!;
    const key = `file:${file.id ?? file.path}`;
    return <div className="manager-tree-row" draggable onDragStart={(event) => onDragStart({ type: 'file', file }, event)} style={style}>
      <span className="manager-tree-spacer" />
      <FileText size={16} />
      <span className="manager-tree-name" title={file.path}>{treeTitle(file)}</span>
      <button type="button" className="manager-more-button" aria-label={`打开 ${displayName(file.path)} 的操作`} onClick={() => onMenu(key)}><Ellipsis size={17} /></button>
      {menu === key && <div className="manager-row-menu" role="menu"><button type="button" role="menuitem" onClick={() => onDeleteFile(file)}><Trash2 size={15} />删除</button></div>}
    </div>;
  }

  const open = expanded.has(node.path);
  const key = `folder:${node.path}`;
  const dropAllowed = Boolean(dragging && !(dragging.type === 'folder' && inside(node.path, dragging.path)));
  return <div className="manager-tree-branch">
    <div
      className={`manager-tree-row is-folder ${dropAllowed ? 'is-drop-target' : ''}`}
      draggable
      onDragStart={(event) => onDragStart({ type: 'folder', path: node.path }, event)}
      onDragOver={dropAllowed ? (event) => event.preventDefault() : undefined}
      onDrop={dropAllowed ? () => onDrop(node.path) : undefined}
      style={style}
    >
      <button type="button" className="manager-tree-disclosure" onClick={() => onToggle(node.path)} aria-label={open ? `收起 ${node.name}` : `展开 ${node.name}`}><ChevronRight className={open ? 'is-open' : ''} size={16} /></button>
      <Folder size={17} />
      <span className="manager-tree-name" title={node.path}>{node.name}</span>
      <button type="button" className="manager-more-button" aria-label={`打开 ${node.name} 的操作`} onClick={() => onMenu(key)}><Ellipsis size={17} /></button>
      {menu === key && <div className="manager-row-menu" role="menu"><button type="button" role="menuitem" onClick={() => onDeleteFolder(node.path)}><Trash2 size={15} />删除</button></div>}
    </div>
    {open && node.children.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} expanded={expanded} dragging={dragging} menu={menu} onToggle={onToggle} onDragStart={onDragStart} onDrop={onDrop} onMenu={onMenu} onDeleteFile={onDeleteFile} onDeleteFolder={onDeleteFolder} />)}
  </div>;
}

export default function FileManagement({ onApply, onClose, onNotice, onError }: FileManagementProps) {
  const [snapshot, setSnapshot] = useState<ManagementTree | null>(null);
  const [operations, setOperations] = useState<TreeOperation[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await notesApi.managementTree());
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '无法读取文件结构。');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const projected = useMemo(() => snapshot ? projectTree(snapshot, operations) : { files: [], folders: [] }, [operations, snapshot]);
  const tree = useMemo(() => buildTree(projected.files, projected.folders), [projected]);
  const stage = useCallback((operation: TreeOperation) => {
    setOperations((current) => [...current, operation]);
    setMenu(null);
  }, []);

  const move = useCallback((folder: string) => {
    if (!dragging) return;
    if (dragging.type === 'file') {
      const file = dragging.file;
      if (file.id && file.revision && parent(file.path) !== folder) stage({ type: 'move-file', id: file.id, fromPath: file.path, toFolder: folder, revision: file.revision });
    } else if (parent(dragging.path) !== folder) {
      stage({ type: 'move-folder', fromPath: dragging.path, toPath: folder ? `${folder}/${basename(dragging.path)}` : basename(dragging.path) });
    }
    setDragging(null);
  }, [dragging, stage]);

  const startDrag = useCallback((item: DragItem, event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.type === 'file' ? item.file.path : item.path);
    setMenu(null);
    setDragging(item);
  }, []);

  const apply = useCallback(async () => {
    if (!snapshot || !operations.length || applying) return;
    setApplying(true);
    try {
      const result = await onApply(snapshot.treeVersion, operations);
      setSnapshot(result);
      setOperations([]);
      setExpanded(new Set());
      onNotice('文件结构已同步。');
    } catch (reason) {
      setOperations([]);
      setExpanded(new Set());
      await load();
      const message = reason instanceof Error ? reason.message : '同步失败';
      onError(`${message}，文件结构已刷新，请重新操作。`);
    } finally {
      setApplying(false);
    }
  }, [applying, load, onApply, onError, onNotice, operations, snapshot]);

  return <section className="settings-view settings-detail-view file-management-view">
    <header className="settings-page-header">
      <button type="button" className="settings-header-action settings-back-action" onClick={onClose} aria-label="返回设置"><ArrowLeft size={21} /></button>
      <h1>文件管理</h1>
      <button type="button" className="file-management-confirm" disabled={!operations.length || applying} onClick={() => void apply()}>{applying ? <><LoaderCircle className="spin" size={16} />同步中</> : '确认'}</button>
    </header>
    <main className="settings-detail-content file-management-content">
      <p className="settings-group-label">整理文件</p>
      <section className="settings-detail-group file-management-tree-panel">
        <div
          className={`manager-tree-root ${dragging ? 'is-drop-target' : ''}`}
          onDragOver={(event) => { if (dragging) event.preventDefault(); }}
          onDrop={() => move('')}
        ><FolderTree size={18} /><span>笔记库</span></div>
        <div className="manager-tree" role="tree" aria-label="文件管理树" onDragEnd={() => setDragging(null)}>
          {loading ? <div className="manager-tree-loading"><LoaderCircle className="spin" size={18} />正在读取文件结构</div>
            : tree.length ? tree.map((node) => <TreeItem key={node.path} node={node} depth={0} expanded={expanded} dragging={dragging} menu={menu} onToggle={(path) => setExpanded((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; })} onDragStart={startDrag} onDrop={move} onMenu={(key) => setMenu((current) => current === key ? null : key)} onDeleteFile={(file) => { if (file.id && file.revision) stage({ type: 'delete-file', id: file.id, path: file.path, revision: file.revision }); }} onDeleteFolder={(path) => stage({ type: 'delete-folder', path, recursive: true })} />)
              : <p className="manager-tree-empty">暂无文件</p>}
        </div>
      </section>
    </main>
  </section>;
}
