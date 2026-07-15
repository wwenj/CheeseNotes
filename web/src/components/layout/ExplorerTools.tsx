import { useEffect, useRef } from 'react';
import { FilePlus, FolderPlus, ListChevronsDownUp, ListChevronsUpDown, ScanSearch, X } from 'lucide-react';

export type ExplorerTool = 'search';

type ExplorerToolsProps = {
  activeTool: ExplorerTool | null;
  search: string;
  folderPaths: string[];
  expanded: Set<string>;
  onToolChange: (tool: ExplorerTool | null) => void;
  onSearch: (value: string) => void;
  onNewFile: () => void;
  onCreateFolder: (path: string) => Promise<boolean>;
  onCollapseAll: () => void;
  onExpandAll: (paths: string[]) => void;
};

function useVisibleFocus(active: boolean) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      if (ref.current?.getClientRects().length) ref.current.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);
  return ref;
}

export default function ExplorerTools({ activeTool, search, folderPaths, expanded, onToolChange, onSearch, onNewFile, onCreateFolder, onCollapseAll, onExpandAll }: ExplorerToolsProps) {
  const searchRef = useVisibleFocus(activeTool === 'search');
  const allExpanded = folderPaths.length > 0 && folderPaths.every((path) => expanded.has(path));

  const closeSearch = () => {
    onSearch('');
    onToolChange(null);
  };

  const createFolder = () => {
    onToolChange(null);
    const path = window.prompt('新目录名称');
    if (path?.trim()) void onCreateFolder(path.trim());
  };

  const toggleFolders = () => {
    onToolChange(null);
    if (allExpanded) onCollapseAll();
    else onExpandAll(folderPaths);
  };

  return <section className="explorer-tools" data-explorer-tools aria-label="文件工具">
    {activeTool === 'search' && <div className="explorer-tool-popover explorer-search-popover" role="search">
      <ScanSearch size={17} strokeWidth={2.1} aria-hidden="true" />
      <input ref={searchRef} type="text" inputMode="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索文件和文件夹" aria-label="搜索文件和文件夹" autoComplete="off" autoCorrect="off" spellCheck="false" />
      <button type="button" className="explorer-popover-close" onClick={closeSearch} aria-label="关闭搜索" title="关闭搜索"><X size={16} /></button>
    </div>}
    <div className="explorer-tools-row">
      <button type="button" className="explorer-tool-button" onClick={() => { onToolChange(null); onNewFile(); }} aria-label="新增文件" title="新增文件"><FilePlus className="explorer-tool-icon" size={23} strokeWidth={2.15} /></button>
      <button type="button" className="explorer-tool-button" onClick={createFolder} aria-label="新增文件夹" title="新增文件夹"><FolderPlus className="explorer-tool-icon" size={23} strokeWidth={2.15} /></button>
      <button type="button" className={activeTool === 'search' ? 'explorer-tool-button is-active' : 'explorer-tool-button'} onClick={() => onToolChange(activeTool === 'search' ? null : 'search')} aria-label="搜索" aria-pressed={activeTool === 'search'} title="搜索（⌘K）"><ScanSearch className="explorer-tool-icon explorer-tool-icon-structured" size={24} strokeWidth={2.15} /></button>
      <button type="button" className="explorer-tool-button" onClick={toggleFolders} disabled={!folderPaths.length} aria-label={allExpanded ? '收起全部文件夹' : '展开全部文件夹'} title={allExpanded ? '收起全部文件夹' : '展开全部文件夹'}>{allExpanded ? <ListChevronsDownUp className="explorer-tool-icon explorer-tool-icon-structured" size={24} strokeWidth={2.15} /> : <ListChevronsUpDown className="explorer-tool-icon explorer-tool-icon-structured" size={24} strokeWidth={2.15} />}</button>
    </div>
  </section>;
}
