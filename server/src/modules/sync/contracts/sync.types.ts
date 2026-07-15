export type SyncState = 'unconfigured' | 'unauthorized' | 'checking' | 'pending' | 'syncing' | 'verified' | 'conflict' | 'failed';
export type SyncPhase = 'idle' | 'fetching' | 'merging' | 'committing' | 'verifying' | 'completed' | 'failed';

export type NoteRow = {
  id: string;
  path: string;
  revision: string;
  updated_at: string;
  title: string | null;
  content: string | null;
  remote_path: string | null;
  remote_sha: string | null;
  base_content: string | null;
  dirty: number;
  deleted: number;
};

export type WorkspaceRow = {
  generation: number;
  verified_generation: number;
  last_remote_head: string;
  verified_remote_head: string;
  verified_at: string;
  state: SyncState;
  phase: SyncPhase;
  last_error: string;
  next_retry_at: string;
  lock_token: string;
  lock_until: string;
  device_id: string;
  updated_at: string;
};
