import { ApiError, apiUrl, notifyAuthExpired, request } from './http';
import { mobileSessionToken } from './mobile-session';

export type NoteSummary = { id?: string; path: string; title?: string; revision?: string; assetVersion?: string; updated_at?: string };
export type Note = { id?: string; path: string; content: string; revision: string };
export type SaveResult = { id: string; path: string; revision: string; sync?: unknown };
export type FolderResult = { path: string; sync: unknown };
export type NoteTreeResult = { files: NoteSummary[] | null; folders: string[] | null; etag: string | null };

async function tree(etag?: string, signal?: AbortSignal, force = false): Promise<NoteTreeResult> {
  const headers = new Headers();
  if (etag) headers.set('If-None-Match', etag);
  const token = await mobileSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(apiUrl('tree?includeFolders=1'), { headers, signal, credentials: 'include', ...(force ? { cache: 'no-store' } : {}) });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason;
    throw new ApiError('无法连接服务，请检查服务地址。');
  }
  if (response.status === 304) return { files: null, folders: null, etag: response.headers.get('etag') ?? etag ?? null };
  if (!response.ok) {
    notifyAuthExpired(response.status);
    const result = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(result?.message) ? result.message.join('；') : result?.message;
    throw new ApiError(message || `请求失败（${response.status}）`, response.status);
  }
  const payload = await response.json() as { files: NoteSummary[]; folders?: string[] };
  return { files: payload.files, folders: payload.folders ?? [], etag: response.headers.get('etag') };
}

export const notesApi = {
  tree,
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
