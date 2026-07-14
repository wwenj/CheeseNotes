import { useState } from 'react';
import { FolderOpen, RefreshCw, Settings2 } from 'lucide-react';
import type { NoteSummary, SyncStatus } from '../../api';
import { formatLastSync, isSyncBusy, stateText } from '../../app/constants';
import type { Panel } from '../../app/types';
import FileTree from '../FileTree';

export type ExplorerProps = {
  files: NoteSummary[];
  selectedPath?: string;
  expanded: Set<string>;
  search: string;
  sync: SyncStatus | null;
  panel: Panel;
  onSearch: (value: string) => void;
  onToggle: (path: string) => void;
  onSelect: (file: NoteSummary) => void;
  onPanel: (panel: Panel) => void;
  onSync: () => Promise<void>;
};

export default function Explorer({ files, selectedPath, expanded, search, sync, panel, onSearch, onToggle, onSelect, onPanel, onSync }: ExplorerProps) {
  const [syncRequested, setSyncRequested] = useState(false);
  const syncing = syncRequested || isSyncBusy(sync);
  const lastSyncAge = sync?.lastSuccessAt ? Date.now() - new Date(sync.lastSuccessAt).getTime() : 0;
  const syncTone = sync?.state === 'failed' ? 'is-failed' : syncing || sync?.state === 'synced' ? 'is-synced' : lastSyncAge > 24 * 60 * 60 * 1000 ? 'is-stale' : '';

  const requestSync = () => {
    if (syncing || !sync?.manualSyncAvailable) return;
    setSyncRequested(true);
    void onSync().finally(() => setSyncRequested(false));
  };

  return <div className="explorer-panel">
    <header className="explorer-header">
      <div className="brand-lockup"><img className="brand-icon" src="/noteai-icon.png" alt="" /><strong>NoteAI</strong></div>
      <button type="button" className={`sync-status ${syncTone}`} disabled={syncing || !sync?.manualSyncAvailable} onClick={requestSync} aria-label={`${stateText[sync?.state ?? 'unconfigured']}，${formatLastSync(sync?.lastSuccessAt ?? '')}`}>
        <RefreshCw className={syncing ? 'spin' : ''} size={16} />
        <span><b>{stateText[sync?.state ?? 'unconfigured']}</b><small>{formatLastSync(sync?.lastSuccessAt ?? '')}</small></span>
      </button>
    </header>
    <FileTree files={files} selectedPath={selectedPath} expanded={expanded} search={search} onSearch={onSearch} onToggle={onToggle} onSelect={onSelect} />
    <footer className="explorer-footer">
      <button type="button" className={panel === 'settings' ? 'side-action is-active' : 'side-action'} onClick={() => onPanel('settings')}>
        <Settings2 size={17} /><span>设置</span>
      </button>
      <span className="sidebar-count"><FolderOpen size={15} />共 {files.length} 个文件</span>
    </footer>
  </div>;
}
