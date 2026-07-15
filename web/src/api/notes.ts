import { ApiError, apiUrl, request } from './http';

export type NoteSummary = { path: string; revision?: string; assetVersion?: string; updated_at?: string };
export type Note = { path: string; content: string; revision: string };
export type SaveResult = { path: string; revision: string };
export type NoteTreeResult = { files: NoteSummary[] | null; etag: string | null };

async function tree(etag?: string, signal?: AbortSignal): Promise<NoteTreeResult> {
  const headers = new Headers();
  if (etag) headers.set('If-None-Match', etag);
  let response: Response;
  try {
    response = await fetch(apiUrl('tree'), { headers, signal });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason;
    throw new ApiError('无法连接服务，请检查服务地址。');
  }
  if (response.status === 304) return { files: null, etag: response.headers.get('etag') ?? etag ?? null };
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(result?.message) ? result.message.join('；') : result?.message;
    throw new ApiError(message || `请求失败（${response.status}）`, response.status);
  }
  return { files: await response.json() as NoteSummary[], etag: response.headers.get('etag') };
}

export const notesApi = {
  tree,
  content: (path: string, signal?: AbortSignal) => request<Note>(`notes/content?path=${encodeURIComponent(path)}`, { signal }),
  search: (q: string) => request<NoteSummary[]>(`search?q=${encodeURIComponent(q)}`),
  create: (path: string, content: string) => request<SaveResult>('notes', { method: 'POST', body: JSON.stringify({ path, content }) }),
  update: (path: string, content: string, revision: string) => request<SaveResult>('notes', { method: 'PUT', body: JSON.stringify({ path, content, revision }) }),
  remove: (path: string, revision: string) => request<{ sync: unknown }>('notes', { method: 'DELETE', body: JSON.stringify({ path, revision }) }),
  fileUrl: (path: string, version?: string) => {
    const url = apiUrl(`files?path=${encodeURIComponent(path)}`);
    return version ? `${url}&v=${encodeURIComponent(version)}` : url;
  },
};
