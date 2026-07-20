import { apiUrl, request } from './http';

export type NoteSummary = { id?: string; path: string; title?: string; revision?: string; assetVersion?: string; updated_at?: string };
export type Note = { id?: string; path: string; content: string; revision: string };
export type SaveResult = { id: string; path: string; revision: string; sync?: unknown };
export type FolderResult = { path: string; sync: unknown };
export type NoteTreeResult = { files: NoteSummary[]; folders: string[] };
export type ManagementTree = NoteTreeResult & { treeVersion: string };
export type TreeOperation =
  | { type: 'move-file'; id: string; fromPath: string; toFolder: string; revision: string }
  | { type: 'move-folder'; fromPath: string; toPath: string }
  | { type: 'delete-file'; id: string; path: string; revision: string }
  | { type: 'delete-folder'; path: string; recursive?: boolean };
export type TreeChangesResult = ManagementTree & { sync: unknown };

async function tree(signal?: AbortSignal): Promise<NoteTreeResult> {
  return request<NoteTreeResult>('tree', { signal, cache: 'no-store' });
}

export const notesApi = {
  tree,
  managementTree: () => request<ManagementTree>('tree/management', { cache: 'no-store' }),
  applyTreeChanges: (baseTreeVersion: string, operations: TreeOperation[]) => request<TreeChangesResult>('tree/changes', { method: 'POST', body: JSON.stringify({ baseTreeVersion, operations }) }),
  content: (path: string, signal?: AbortSignal) => request<Note>(`notes/content?path=${encodeURIComponent(path)}`, { signal }),
  search: (q: string) => request<NoteSummary[]>(`search?q=${encodeURIComponent(q)}`),
  create: (path: string, content: string, id?: string) => request<SaveResult>('notes', { method: 'POST', body: JSON.stringify({ path, content, ...(id ? { id } : {}) }) }),
  createFolder: (path: string) => request<FolderResult>('folders', { method: 'POST', body: JSON.stringify({ path }) }),
  update: (path: string, content: string, revision: string, id?: string) => request<SaveResult>('notes', { method: 'PUT', body: JSON.stringify({ path, content, revision, ...(id ? { id } : {}) }) }),
  remove: (path: string, revision: string, id?: string) => request<{ sync: unknown }>('notes', { method: 'DELETE', body: JSON.stringify({ path, revision, ...(id ? { id } : {}) }) }),
  fileUrl: (path: string, version?: string) => {
    const url = apiUrl(`files?path=${encodeURIComponent(path)}`);
    return version ? `${url}&v=${encodeURIComponent(version)}` : url;
  },
};
