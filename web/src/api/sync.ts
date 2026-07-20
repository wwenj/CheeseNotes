import { request } from './http';

export type SyncStatus = {
  state: 'unconfigured' | 'unauthorized' | 'checking' | 'pending' | 'syncing' | 'verified' | 'conflict' | 'failed';
  phase: 'idle' | 'cloning' | 'fetching' | 'merging' | 'committing' | 'pushing' | 'verifying' | 'completed' | 'failed';
  dirtyCount: number;
  conflictCount: number;
  generation: number;
  verifiedGeneration: number;
  remoteHead: string;
  verifiedAt: string;
  lastError: string;
  manualSyncAvailable: boolean;
};

export type ConflictAction = 'keep-both' | 'keep-local' | 'use-remote' | 'manual';
export type ConflictOperation = 'create' | 'update' | 'delete';
export type ConflictDecision = { action: ConflictAction; content?: string | null; copyPath?: string | null };
export type SyncConflict = {
  id: string;
  path: string;
  remote_commit: string;
  created_at: string;
  operation: ConflictOperation;
  resolution_action: ConflictAction | null;
  resolution_copy_path: string | null;
  local_bytes: number;
  remote_bytes: number;
};
export type ConflictDetail = SyncConflict & {
  base_content: string | null;
  local_content: string | null;
  remote_content: string | null;
  resolution_content: string | null;
  resolution_updated_at: string | null;
};
export type ConflictPage = { items: SyncConflict[]; nextCursor: string | null; total: number; resolutionDraftCount: number };
export type ConflictReview = 'all' | 'undecided' | 'decided';

export const syncApi = {
  status: () => request<SyncStatus>('sync/status'),
  run: () => request<SyncStatus>('sync', { method: 'POST' }),
  health: () => request<{ ok: boolean }>('health'),
  conflicts: (options: { cursor?: string; limit?: number; query?: string; review?: ConflictReview } = {}) => {
    const params = new URLSearchParams();
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.query?.trim()) params.set('q', options.query.trim());
    if (options.review && options.review !== 'all') params.set('review', options.review);
    const suffix = params.size ? `?${params}` : '';
    return request<ConflictPage>(`sync/conflicts${suffix}`);
  },
  conflict: (id: string) => request<ConflictDetail>(`sync/conflicts/${id}`),
  saveDecision: (id: string, action: ConflictAction, content?: string) => request<{ ok: boolean; conflict: ConflictDetail; sync: SyncStatus }>(`sync/conflicts/${id}/decision`, { method: 'PUT', body: JSON.stringify({ action, ...(content === undefined ? {} : { content }) }) }),
  saveAllDecisions: (action: Exclude<ConflictAction, 'manual'>) => request<{ ok: boolean; sync: SyncStatus }>('sync/conflicts/decisions', { method: 'PUT', body: JSON.stringify({ action }) }),
  clearDecision: (id: string) => request<{ ok: boolean; conflict: ConflictDetail; sync: SyncStatus }>(`sync/conflicts/${id}/decision`, { method: 'PUT', body: JSON.stringify({ clear: true }) }),
  applyDecisions: () => request<SyncStatus>('sync/conflicts/apply-decisions', { method: 'POST' }),
};
