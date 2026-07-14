import { apiUrl, request } from './http';

export type NoteSummary = { path: string; revision?: string; updated_at?: string };
export type Note = { path: string; content: string; revision: string };
export type SaveResult = { path: string; revision: string };

export const notesApi = {
  tree: () => request<NoteSummary[]>('tree'),
  content: (path: string) => request<Note>(`notes/content?path=${encodeURIComponent(path)}`),
  search: (q: string) => request<NoteSummary[]>(`search?q=${encodeURIComponent(q)}`),
  create: (path: string, content: string) => request<SaveResult>('notes', { method: 'POST', body: JSON.stringify({ path, content }) }),
  update: (path: string, content: string, revision: string) => request<SaveResult>('notes', { method: 'PUT', body: JSON.stringify({ path, content, revision }) }),
  remove: (path: string, revision: string) => request<{ sync: unknown }>('notes', { method: 'DELETE', body: JSON.stringify({ path, revision }) }),
  fileUrl: (path: string) => apiUrl(`files?path=${encodeURIComponent(path)}`),
};
