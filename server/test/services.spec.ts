import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathPolicy } from '../src/modules/storage/path-policy.service.js';
import { NoteService } from '../src/modules/notes/note.service.js';
import { SyncService } from '../src/modules/sync/sync.service.js';
import type { DatabaseService } from '../src/modules/database/database.service.js';
import type { FileStoreService } from '../src/modules/storage/file-store.service.js';
import type { GitHubService } from '../src/modules/github/github.service.js';
import type { RepositoryService } from '../src/modules/settings/repository.service.js';
import { hash } from '../src/common/crypto.js';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE notes(id TEXT,path TEXT PRIMARY KEY,revision TEXT,updated_at TEXT,remote_sha TEXT,title TEXT,content TEXT,remote_path TEXT,base_content TEXT,dirty INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE pending(path TEXT PRIMARY KEY,op TEXT,base_commit TEXT,base_blob TEXT,base_content TEXT,local_content TEXT,updated_at TEXT);
    CREATE TABLE local_folders(path TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE conflicts(id TEXT PRIMARY KEY,path TEXT,base_content TEXT,local_content TEXT,remote_content TEXT,remote_commit TEXT,created_at TEXT,operation TEXT,resolution_action TEXT,resolution_content TEXT,resolution_copy_path TEXT,resolution_updated_at TEXT);
    CREATE TABLE sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,state TEXT,error TEXT,created_at TEXT);
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT);
    CREATE TABLE sync_workspace(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL DEFAULT 0,verified_generation INTEGER NOT NULL DEFAULT -1,last_remote_head TEXT NOT NULL DEFAULT '',verified_remote_head TEXT NOT NULL DEFAULT '',verified_at TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'pending',phase TEXT NOT NULL DEFAULT 'idle',last_error TEXT NOT NULL DEFAULT '',next_retry_at TEXT NOT NULL DEFAULT '',lock_token TEXT NOT NULL DEFAULT '',lock_until TEXT NOT NULL DEFAULT '',device_id TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '');
    INSERT INTO sync_workspace(id) VALUES(1);
  `);
  return { db } as DatabaseService;
}

function syncFixture() {
  const db = database();
  const paths = new PathPolicy();
  const files = { clear: vi.fn(), exists: vi.fn().mockReturnValue(true), readText: vi.fn(), folders: vi.fn().mockResolvedValue([]), file: vi.fn(), createFolder: vi.fn() } as unknown as FileStoreService;
  const repository = { get: vi.fn().mockReturnValue(''), branch: vi.fn(), setBranch: vi.fn() } as unknown as RepositoryService;
  const github = { hasToken: vi.fn().mockReturnValue(false), raw: vi.fn() } as unknown as GitHubService;
  return { db, paths, files, repository, github, sync: new SyncService(db, paths, repository, github, files) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('durable sync state', () => {
  it('未配置仓库时明确报告未配置，而不是同步成功', () => {
    const { sync } = syncFixture();
    expect(sync.triggerSync().state).toBe('unconfigured');
  });

  it('本地保存写入 SQLite 内容和 dirty，不依赖文件系统', async () => {
    const { db, paths, files, sync } = syncFixture();
    const notes = new NoteService(db, paths, files, sync);
    const result = await notes.save('未命名.md', '# 正确标题\n\n内容');
    expect(result.path).toBe('正确标题.md');
    expect(db.db.prepare('SELECT content,dirty,remote_path FROM notes WHERE id=?').get(result.id)).toEqual({ content: '# 正确标题\n\n内容', dirty: 1, remote_path: null });
    expect(db.db.prepare('SELECT generation FROM sync_workspace WHERE id=1').get()).toEqual({ generation: 1 });
  });

  it('本地保存后静默 10 分钟才启动 GitHub 同步', async () => {
    vi.useFakeTimers();
    const { sync } = syncFixture();
    const start = vi.spyOn(sync as unknown as { startSync: () => unknown }, 'startSync').mockImplementation(() => undefined);

    sync.schedule();
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('强制同步跳过静默等待', () => {
    vi.useFakeTimers();
    const { sync } = syncFixture();
    const start = vi.spyOn(sync as unknown as { startSync: () => unknown }, 'startSync').mockImplementation(() => undefined);

    sync.schedule();
    sync.triggerSync();
    expect(start).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('服务启动后立即发起同步', async () => {
    const { sync } = syncFixture();
    const trigger = vi.spyOn(sync, 'triggerSync').mockReturnValue(sync.status());

    await (sync as unknown as { bootstrap: () => Promise<void> }).bootstrap();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('旧同步快照只推进新版的远端基线，不把新版误判为冲突', async () => {
    const { db, sync, github } = syncFixture();
    const uploadedContent = '# 标题\n已上传版本';
    const newerContent = '# 标题\n继续编辑的新版本';
    const uploadedRevision = hash(uploadedContent);
    const newerRevision = hash(newerContent);
    db.db.prepare('INSERT INTO notes(id,path,revision,updated_at,remote_sha,title,content,remote_path,base_content,dirty,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run('n1', '标题.md', newerRevision, 'now', 'base-sha', '标题', newerContent, '标题.md', '# 标题\n初始版本', 1);
    (github.raw as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from(uploadedContent));
    const remote = { head: 'head', treeSha: 'tree', entries: new Map([['标题.md', { path: '标题.md', type: 'blob', sha: 'blob' }]]) };
    await (sync as unknown as { verifyAndAcknowledge: (repo: string, remote: unknown, claims: unknown[]) => Promise<void> }).verifyAndAcknowledge('owner/repo', remote, [{ id: 'n1', path: '标题.md', remote_path: '标题.md', content: uploadedContent, revision: uploadedRevision, deleted: 0 }]);
    expect(db.db.prepare('SELECT revision,dirty,remote_path,remote_sha,base_content FROM notes WHERE id=?').get('n1')).toEqual({ revision: newerRevision, dirty: 1, remote_path: '标题.md', remote_sha: 'blob', base_content: uploadedContent });

    await (sync as unknown as { reconcileRemote: (repo: string, remote: unknown) => Promise<void> }).reconcileRemote('owner/repo', remote);
    expect(db.db.prepare('SELECT count(*) count FROM conflicts').get()).toEqual({ count: 0 });
  });

  it('远端与本地同时修改时保留远端原件和本地冲突副本', () => {
    const { db, sync } = syncFixture();
    db.db.prepare('INSERT INTO notes(id,path,revision,updated_at,remote_sha,title,content,remote_path,base_content,dirty,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run('n1', '标题.md', hash('本地'), 'now', 'old', '标题', '本地', '标题.md', '基准', 1);
    (sync as unknown as { makeConflict: (note: unknown, remote: string, sha: string, head: string) => void }).makeConflict(db.db.prepare('SELECT * FROM notes WHERE id=?').get('n1'), '远端', 'new', 'head');
    expect(db.db.prepare('SELECT content,dirty FROM notes WHERE id=?').get('n1')).toEqual({ content: '远端', dirty: 0 });
    expect(db.db.prepare("SELECT count(*) count FROM notes WHERE path LIKE '标题（冲突-%' AND dirty=1").get()).toEqual({ count: 1 });
    expect(db.db.prepare('SELECT count(*) count FROM conflicts').get()).toEqual({ count: 1 });
  });

  it('本地与 GitHub 同时新建同路径文件时创建冲突而不覆盖远端', async () => {
    const { db, sync, github } = syncFixture();
    const localContent = '# 标题\n本地新建';
    const remoteContent = '# 标题\nGitHub 新建';
    db.db.prepare('INSERT INTO notes(id,path,revision,updated_at,remote_sha,title,content,remote_path,base_content,dirty,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run('n1', '标题.md', hash(localContent), 'now', null, '标题', localContent, null, null, 1);
    (github.raw as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from(remoteContent));
    const remote = { head: 'head', treeSha: 'tree', entries: new Map([['标题.md', { path: '标题.md', type: 'blob', sha: 'remote-sha' }]]) };

    await (sync as unknown as { reconcileRemote: (repo: string, remote: unknown) => Promise<void> }).reconcileRemote('owner/repo', remote);

    expect(db.db.prepare('SELECT content,dirty,remote_path FROM notes WHERE id=?').get('n1')).toEqual({ content: remoteContent, dirty: 0, remote_path: '标题.md' });
    expect(db.db.prepare("SELECT count(*) count FROM notes WHERE path LIKE '标题（冲突-%' AND dirty=1").get()).toEqual({ count: 1 });
    expect(db.db.prepare('SELECT operation FROM conflicts').get()).toEqual({ operation: 'create' });
  });
});
