export type SyncState = 'unconfigured' | 'unauthorized' | 'checking' | 'pending' | 'syncing' | 'verified' | 'conflict' | 'failed';
export type SyncPhase = 'idle' | 'cloning' | 'fetching' | 'merging' | 'committing' | 'pushing' | 'verifying' | 'completed' | 'failed';

export type RepositoryStateRow = {
  repository: string;
  branch: string;
  local_head: string;
  remote_head: string;
  generation: number;
  verified_generation: number;
  dirty_count: number;
  state: SyncState;
  phase: SyncPhase;
  last_error: string;
  verified_at: string;
  device_id: string;
  lock_token: string;
  updated_at: string;
};

export type SyncStatus = {
  state: SyncState;
  phase: SyncPhase;
  dirtyCount: number;
  conflictCount: number;
  generation: number;
  verifiedGeneration: number;
  remoteHead: string;
  verifiedAt: string;
  lastError: string;
  manualSyncAvailable: boolean;
};
