import type { Note } from '../api';
import { isNativeIOS, mobileSessionToken } from '../api/mobile-session';

const databaseName = 'noteai-reading-cache';
const databaseVersion = 3;
const documentStore = 'documents';
const assetStore = 'assets';
const assetCacheName = 'noteai-assets-v1';
const maxMemoryDocuments = 24;
const maxMemoryBytes = 8 * 1024 * 1024;
const maxPersistentDocumentBytes = 100 * 1024 * 1024;
const maxAssetBytes = 300 * 1024 * 1024;

type CachedDocument = Note & {
  id: string;
  workspaceKey: string;
  bytes: number;
  accessedAt: number;
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
      if (database.objectStoreNames.contains('workspaces')) database.deleteObjectStore('workspaces');
      if (database.objectStoreNames.contains('drafts')) database.deleteObjectStore('drafts');
      if (!database.objectStoreNames.contains(documentStore)) {
        const store = database.createObjectStore(documentStore, { keyPath: 'id' });
        store.createIndex('workspaceKey', 'workspaceKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(assetStore)) database.createObjectStore(assetStore, { keyPath: 'url' });
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

export async function clearCachedWorkspace(key: string) {
  const documents = await transaction<CachedDocument[]>(documentStore, 'readonly', (store) => store.index('workspaceKey').getAll(IDBKeyRange.only(key))) ?? [];
  for (const document of documents) {
    memoryDocuments.delete(document.id);
    await transaction(documentStore, 'readwrite', (store) => store.delete(document.id));
  }
}

export async function cachedAssetSource(source: string) {
  const canCache = 'caches' in globalThis;
  if (typeof URL.createObjectURL !== 'function') {
    if (isNativeIOS()) throw new Error('当前设备不支持受保护媒体预览');
    return { source, release: () => {} };
  }
  const cache = canCache ? await caches.open(assetCacheName) : null;
  let response = cache ? await cache.match(source) : undefined;
  if (!response) {
    const headers = new Headers();
    const token = await mobileSessionToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    response = await fetch(source, { headers, credentials: 'include' });
    if (!response.ok) throw new Error(`资源请求失败（${response.status}）`);
    await cache?.put(source, response.clone());
  }
  const blob = await response.blob();
  await touchAsset({ url: source, bytes: blob.size, accessedAt: Date.now() });
  if (cache) await pruneAssets(cache);
  const objectUrl = URL.createObjectURL(blob);
  return { source: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
}

export async function clearCachedAssets() {
  if ('caches' in globalThis) await caches.delete(assetCacheName);
  const records = await transaction<CachedAsset[]>(assetStore, 'readonly', (store) => store.getAll()) ?? [];
  for (const record of records) await transaction(assetStore, 'readwrite', (store) => store.delete(record.url));
}
