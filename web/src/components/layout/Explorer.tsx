import { useMemo, useState } from 'react';
import { FolderOpen, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { NoteSummary, SyncStatus } from '../../api';
import { formatLastSync, isSyncBusy, stateText } from '../../app/constants';
import type { Panel } from '../../app/types';
import FileTree from '../FileTree';
import ExplorerTools, { type ExplorerTool } from './ExplorerTools';
import { folderPaths } from '../../lib/files';

export type ExplorerProps = {
  files: NoteSummary[];
  folders: string[];
  selectedPath?: string;
  expanded: Set<string>;
  search: string;
  activeTool: ExplorerTool | null;
  sync: SyncStatus | null;
  panel: Panel;
  onSearch: (value: string) => void;
  onToolChange: (tool: ExplorerTool | null) => void;
  onToggle: (path: string) => void;
  onCollapseAll: () => void;
  onExpandAll: (paths: string[]) => void;
  onRevealFolder: (path: string) => void;
  onSelect: (file: NoteSummary) => void;
  onNewFile: () => void;
  onCreateFolder: (path: string) => Promise<boolean>;
  onPanel: (panel: Panel) => void;
  onSync: () => Promise<void>;
};

export default function Explorer({ files, folders, selectedPath, expanded, search, activeTool, sync, panel, onSearch, onToolChange, onToggle, onCollapseAll, onExpandAll, onRevealFolder, onSelect, onNewFile, onCreateFolder, onPanel, onSync }: ExplorerProps) {
  const [syncRequested, setSyncRequested] = useState(false);
  const syncing = syncRequested || isSyncBusy(sync);
  const conflictBlocked = sync?.syncBlockedByConflicts || sync?.state === 'conflict';
  const lastSyncAge = sync?.lastSuccessAt ? Date.now() - new Date(sync.lastSuccessAt).getTime() : 0;
  const syncTone = conflictBlocked ? 'is-conflict' : sync?.state === 'failed' ? 'is-failed' : syncing || sync?.state === 'verified' ? 'is-synced' : lastSyncAge > 24 * 60 * 60 * 1000 ? 'is-stale' : '';
  const treeFolderPaths = useMemo(() => folderPaths(files, folders), [files, folders]);

  const requestSync = () => {
    if (conflictBlocked) {
      onPanel('sync');
      return;
    }
    if (syncing || !sync?.manualSyncAvailable) return;
    setSyncRequested(true);
    void onSync().finally(() => setSyncRequested(false));
  };

  return <div className="explorer-panel">
    <header className="explorer-header">
      <div className="brand-lockup"><img className="brand-icon" src="/images/cheese-logo.png" alt="" /><strong>芝士</strong></div>
      <button type="button" className={`sync-status ${syncTone}`} disabled={!conflictBlocked && (syncing || !sync?.manualSyncAvailable)} onClick={requestSync} aria-label={conflictBlocked ? `处理 ${sync?.conflictCount ?? 0} 个同步冲突` : `${stateText[sync?.state ?? 'unconfigured']}，${formatLastSync(sync?.lastSuccessAt ?? '')}`}>
        <RefreshCw className={syncing ? 'spin' : ''} size={16} />
        <span><b>{conflictBlocked ? `同步冲突` : stateText[sync?.state ?? 'unconfigured']}</b><small>{conflictBlocked ? '点击处理' : formatLastSync(sync?.lastSuccessAt ?? '')}</small></span>
      </button>
    </header>
    <FileTree files={files} folders={folders} selectedPath={selectedPath} expanded={expanded} search={search} searchOpen={activeTool === 'search'} onToggle={onToggle} onSelect={onSelect} onRevealFolder={onRevealFolder} />
    <ExplorerTools activeTool={activeTool} search={search} folderPaths={treeFolderPaths} expanded={expanded} onToolChange={onToolChange} onSearch={onSearch} onNewFile={onNewFile} onCreateFolder={onCreateFolder} onCollapseAll={onCollapseAll} onExpandAll={onExpandAll} />
    <footer className="explorer-footer">
      <span className="sidebar-count"><FolderOpen size={15} />共 {files.length} 个文件</span>
      <button type="button" className={panel === 'settings' ? 'side-action settings-action is-active' : 'side-action settings-action'} onClick={() => onPanel('settings')} aria-label="打开设置" title="设置">
        <SlidersHorizontal size={19} strokeWidth={2.2} /><span>设置</span>
      </button>
    </footer>
  </div>;
}
