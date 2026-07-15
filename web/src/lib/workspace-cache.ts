import type { Note, NoteSummary } from '../api';

const databaseName = 'noteai-reading-cache';
const databaseVersion = 2;
const documentStore = 'documents';
const workspaceStore = 'workspaces';
const assetStore = 'assets';
const draftStore = 'drafts';
const assetCacheName = 'noteai-assets-v1';
const maxMemoryDocuments = 24;
const maxMemoryBytes = 8 * 1024 * 1024;
const maxPersistentDocumentBytes = 100 * 1024 * 1024;
const maxAssetBytes = 300 * 1024 * 1024;

export type CachedWorkspace = {
  key: string;
  files: NoteSummary[];
  folders: string[];
  etag: string | null;
  lastPath: string | null;
  updatedAt: number;
};

type CachedDocument = Note & {
  id: string;
  workspaceKey: string;
  bytes: number;
  accessedAt: number;
};

export type CachedDraft = {
  id: string;
  workspaceKey: string;
  path: string;
  content: string;
  revision: string;
  updatedAt: number;
};

type CachedAsset = {
  url: string;
  bytes: number;
  accessedAt: number;
};

const memoryDocuments = new Map<string, CachedDocument>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

const documentId = (workspaceKey: string, path: string) => `${workspaceKey}\u0000${path}`;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(workspaceStore)) database.createObjectStore(workspaceStore, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(documentStore)) {
        const store = database.createObjectStore(documentStore, { keyPath: 'id' });
        store.createIndex('workspaceKey', 'workspaceKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(assetStore)) database.createObjectStore(assetStore, { keyPath: 'url' });
      if (!database.objectStoreNames.contains(draftStore)) {
        const store = database.createObjectStore(draftStore, { keyPath: 'id' });
        store.createIndex('workspaceKey', 'workspaceKey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

async function transaction<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const database = await openDatabase();
  if (!database) return undefined;
  return new Promise((resolve) => {
    const tx = database.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => resolve(undefined);
    tx.onabort = () => resolve(undefined);
  });
}

function touchMemory(record: CachedDocument) {
  memoryDocuments.delete(record.id);
  memoryDocuments.set(record.id, record);
  let bytes = [...memoryDocuments.values()].reduce((total, item) => total + item.bytes, 0);
  while (memoryDocuments.size > maxMemoryDocuments || bytes > maxMemoryBytes) {
    const oldest = memoryDocuments.entries().next().value as [string, CachedDocument] | undefined;
    if (!oldest) break;
    memoryDocuments.delete(oldest[0]);
    bytes -= oldest[1].bytes;
  }
}

async function pruneDocuments() {
  const records = await transaction<CachedDocument[]>(documentStore, 'readonly', (store) => store.getAll()) ?? [];
  let bytes = records.reduce((total, record) => total + record.bytes, 0);
  for (const record of records.sort((a, b) => a.accessedAt - b.accessedAt)) {
    if (bytes <= maxPersistentDocumentBytes) break;
    await transaction(documentStore, 'readwrite', (store) => store.delete(record.id));
    bytes -= record.bytes;
  }
}

async function touchAsset(record: CachedAsset) {
  await transaction(assetStore, 'readwrite', (store) => store.put(record));
}

async function pruneAssets(cache: Cache) {
  const records = await transaction<CachedAsset[]>(assetStore, 'readonly', (store) => store.getAll()) ?? [];
  let bytes = records.reduce((total, record) => total + record.bytes, 0);
  for (const record of records.sort((a, b) => a.accessedAt - b.accessedAt)) {
    if (bytes <= maxAssetBytes) break;
    await cache.delete(record.url);
    await transaction(assetStore, 'readwrite', (store) => store.delete(record.url));
    bytes -= record.bytes;
  }
}

export async function readCachedWorkspace(key: string) {
  const cached = await transaction<CachedWorkspace>(workspaceStore, 'readonly', (store) => store.get(key));
  return cached ? { ...cached, folders: cached.folders ?? [] } : cached;
}

export async function writeCachedWorkspace(key: string, files: NoteSummary[], folders: string[], etag: string | null) {
  const current = await readCachedWorkspace(key);
  const record: CachedWorkspace = { key, files, folders, etag, lastPath: current?.lastPath ?? null, updatedAt: Date.now() };
  await transaction(workspaceStore, 'readwrite', (store) => store.put(record));
  return record;
}

export async function setCachedLastPath(key: string, path: string) {
  const current = await readCachedWorkspace(key);
  if (!current) return;
  await transaction(workspaceStore, 'readwrite', (store) => store.put({ ...current, lastPath: path, updatedAt: Date.now() } satisfies CachedWorkspace));
}

export async function readCachedDocument(workspaceKey: string, path: string) {
  const id = documentId(workspaceKey, path);
  const memory = memoryDocuments.get(id);
  if (memory) {
    memory.accessedAt = Date.now();
    touchMemory(memory);
    return memory;
  }
  const record = await transaction<CachedDocument>(documentStore, 'readonly', (store) => store.get(id));
  if (!record) return undefined;
  record.accessedAt = Date.now();
  touchMemory(record);
  void transaction(documentStore, 'readwrite', (store) => store.put(record));
  return record;
}

export async function writeCachedDocument(workspaceKey: string, note: Note) {
  const record: CachedDocument = {
    ...note,
    id: documentId(workspaceKey, note.path),
    workspaceKey,
    bytes: byteLength(note.content),
    accessedAt: Date.now(),
  };
  touchMemory(record);
  await transaction(documentStore, 'readwrite', (store) => store.put(record));
  await pruneDocuments();
}

export async function removeCachedDocument(workspaceKey: string, path: string) {
  const id = documentId(workspaceKey, path);
  memoryDocuments.delete(id);
  await transaction(documentStore, 'readwrite', (store) => store.delete(id));
}

const draftId = (workspaceKey: string, path: string) => `draft\u0000${documentId(workspaceKey, path)}`;

async function updateDraftRecord(record: CachedDraft) {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const tx = database.transaction(draftStore, 'readwrite');
    const store = tx.objectStore(draftStore);
    const current = store.get(record.id);
    current.onsuccess = () => {
      const existing = current.result as CachedDraft | undefined;
      if (!existing || existing.updatedAt <= record.updatedAt) store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function writeCachedDraft(workspaceKey: string, draft: Omit<CachedDraft, 'id' | 'workspaceKey'>) {
  await updateDraftRecord({ ...draft, id: draftId(workspaceKey, draft.path), workspaceKey });
}

export async function readCachedDraft(workspaceKey: string, path: string) {
  return transaction<CachedDraft>(draftStore, 'readonly', (store) => store.get(draftId(workspaceKey, path)));
}

export async function readCachedDrafts(workspaceKey: string) {
  const database = await openDatabase();
  if (!database) return [] as CachedDraft[];
  return new Promise<CachedDraft[]>((resolve) => {
    const tx = database.transaction(draftStore, 'readonly');
    const request = tx.objectStore(draftStore).index('workspaceKey').getAll(IDBKeyRange.only(workspaceKey));
    request.onsuccess = () => resolve(request.result as CachedDraft[]);
    request.onerror = () => resolve([]);
    tx.onabort = () => resolve([]);
  });
}

export async function removeCachedDraft(workspaceKey: string, path: string, throughUpdatedAt = Number.POSITIVE_INFINITY) {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const tx = database.transaction(draftStore, 'readwrite');
    const store = tx.objectStore(draftStore);
    const current = store.get(draftId(workspaceKey, path));
    current.onsuccess = () => {
      const existing = current.result as CachedDraft | undefined;
      if (existing && existing.updatedAt <= throughUpdatedAt) store.delete(existing.id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function clearCachedDrafts(workspaceKey: string) {
  const drafts = await readCachedDrafts(workspaceKey);
  await Promise.all(drafts.map((draft) => removeCachedDraft(workspaceKey, draft.path)));
}

export async function clearCachedWorkspace(key: string) {
  const documents = await transaction<CachedDocument[]>(documentStore, 'readonly', (store) => store.index('workspaceKey').getAll(IDBKeyRange.only(key))) ?? [];
  for (const document of documents) {
    memoryDocuments.delete(document.id);
    await transaction(documentStore, 'readwrite', (store) => store.delete(document.id));
  }
  await transaction(workspaceStore, 'readwrite', (store) => store.delete(key));
}

export async function cachedAssetSource(source: string) {
  if (!('caches' in globalThis) || typeof URL.createObjectURL !== 'function') return { source, release: () => {} };
  const cache = await caches.open(assetCacheName);
  let response = await cache.match(source);
  if (!response) {
    response = await fetch(source);
    if (!response.ok) throw new Error(`资源请求失败（${response.status}）`);
    await cache.put(source, response.clone());
  }
  const blob = await response.blob();
  await touchAsset({ url: source, bytes: blob.size, accessedAt: Date.now() });
  await pruneAssets(cache);
  const objectUrl = URL.createObjectURL(blob);
  return { source: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
}

export async function clearCachedAssets() {
  if ('caches' in globalThis) await caches.delete(assetCacheName);
  const records = await transaction<CachedAsset[]>(assetStore, 'readonly', (store) => store.getAll()) ?? [];
  for (const record of records) await transaction(assetStore, 'readwrite', (store) => store.delete(record.url));
}
