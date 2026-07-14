export type SyncState = 'unconfigured' | 'unauthorized' | 'initializing' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
export type SyncPhase = 'idle' | 'validating-auth' | 'validating-repository' | 'loading-tree' | 'downloading' | 'activating' | 'uploading' | 'refreshing' | 'completed' | 'failed';
export type PendingOperation = 'create' | 'update' | 'delete';
export type PendingRow = { path: string; op: PendingOperation; base_blob: string | null; base_content: string | null; local_content: string | null };
export type NoteRow = { path: string; revision: string; remote_sha: string | null; updated_at: string };
