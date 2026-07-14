import { request } from './http';

export type SyncStatus = {
  state: 'unconfigured' | 'unauthorized' | 'initializing' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
  phase: 'idle' | 'validating-auth' | 'validating-repository' | 'loading-tree' | 'downloading' | 'activating' | 'uploading' | 'refreshing' | 'completed' | 'failed';
  currentPath: string;
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  pendingCount: number;
  conflictCount: number;
  lastSuccessAt: string;
  lastError: string;
  manualSyncAvailable: boolean;
};

export type SyncConflict = { id: string; path: string; remote_commit: string; created_at: string };
export type ConflictDetail = SyncConflict & { base_content: string | null; local_content: string | null; remote_content: string | null };

export const syncApi = {
  status: () => request<SyncStatus>('sync/status'),
  run: () => request<SyncStatus>('sync', { method: 'POST' }),
  health: () => request<{ ok: boolean }>('health'),
  conflicts: () => request<SyncConflict[]>('sync/conflicts'),
  conflict: (id: string) => request<ConflictDetail>(`sync/conflicts/${id}`),
  resolve: (id: string, action: 'keep-both' | 'keep-local' | 'use-remote' | 'manual', content?: string) => request<{ ok: boolean; sync: SyncStatus }>(`sync/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action, ...(content === undefined ? {} : { content }) }) }),
};
