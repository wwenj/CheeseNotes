import { BadRequestException, Inject, Injectable, OnModuleInit, Optional, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { hash } from '../../common/crypto.js';
import { isText } from '../../common/file-types.js';
import { now, nowForPath } from '../../common/time.js';
import { DatabaseService } from '../database/database.service.js';
import { GitHubService } from '../github/github.service.js';
import { RepositoryService } from '../settings/repository.service.js';
import { FileStoreService } from '../storage/file-store.service.js';
import { PathPolicy } from '../storage/path-policy.service.js';
import type { ConflictAction, ResolveConflictDto } from './contracts/sync.dto.js';
import type { NoteRow, PendingOperation, PendingRow, SyncPhase, SyncState } from './contracts/sync.types.js';

@Injectable()
export class SyncService implements OnModuleInit {
  private active: Promise<void> | null = null;
  private jobId: number | null = null;
  private state: SyncState = 'unconfigured';
  private phase: SyncPhase = 'idle';
  private lastError = '';
  private lastSuccessAt = '';
  private currentPath = '';
  private processedFiles = 0;
  private totalFiles = 0;
  private processedBytes = 0;
  private totalBytes = 0;
  private readonly files: FileStoreService;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PathPolicy) private readonly paths: PathPolicy,
    @Inject(RepositoryService) private readonly repository: RepositoryService,
    @Inject(GitHubService) private readonly github: GitHubService,
    @Optional() @Inject(FileStoreService) files?: FileStoreService,
  ) {
    this.files = files ?? new FileStoreService(paths);
  }

  onModuleInit() {
    if (!this.repository.get()) this.state = 'unconfigured';
    else if (!this.github.hasToken()) this.state = 'unauthorized';
    else if (this.repository.initialized()) this.triggerSync();
    else this.triggerInitialize();
    setInterval(() => this.triggerSync(), 300_000);
  }

  status() {
    return {
      state: this.state,
      phase: this.phase,
      currentPath: this.currentPath,
      processedFiles: this.processedFiles,
      totalFiles: this.totalFiles,
      processedBytes: this.processedBytes,
      totalBytes: this.totalBytes,
      pendingCount: this.count('pending'),
      conflictCount: this.count('conflicts'),
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      manualSyncAvailable: !this.active && Boolean(this.repository.get()) && this.github.hasToken(),
    };
  }

  triggerInitialize() {
    if (!this.repository.get()) {
      this.state = 'unconfigured';
      return this.status();
    }
    if (!this.github.hasToken()) {
      this.state = 'unauthorized';
      return this.status();
    }
    this.launch('initializing', 'validating-auth', () => this.initialize());
    return this.status();
  }

  triggerSync() {
    if (!this.repository.get()) {
      this.state = 'unconfigured';
      return this.status();
    }
    if (!this.github.hasToken()) {
      this.state = 'unauthorized';
      return this.status();
    }
    if (!this.repository.initialized()) return this.triggerInitialize();
    this.launch('syncing', 'validating-repository', () => this.sync());
    return this.status();
  }

  record(path: string, op: PendingOperation, local: string | null, baseContent: string | null) {
    const existing = this.database.db.prepare('SELECT * FROM pending WHERE path=?').get(path) as PendingRow | undefined;
    if (existing?.op === 'create' && op === 'delete') {
      this.database.db.prepare('DELETE FROM pending WHERE path=?').run(path);
      this.state = this.count('pending') ? 'pending' : 'synced';
      return;
    }
    if (existing) {
      const nextOp = existing.op === 'create' && op === 'update' ? 'create' : op;
      this.database.db.prepare('UPDATE pending SET op=?,local_content=?,updated_at=? WHERE path=?').run(nextOp, local, now(), path);
    } else {
      const note = this.database.db.prepare('SELECT remote_sha FROM notes WHERE path=?').get(path) as { remote_sha?: string } | undefined;
      this.database.db.prepare('INSERT INTO pending(path,op,base_commit,base_blob,base_content,local_content,updated_at) VALUES(?,?,?,?,?,?,?)').run(path, op, '', note?.remote_sha ?? null, baseContent, local, now());
    }
    this.state = 'pending';
    this.triggerSync();
  }

  reset() {
    return this.triggerInitialize();
  }

  async resolveConflict(id: string, dto: ResolveConflictDto) {
    const row = this.database.db.prepare('SELECT * FROM conflicts WHERE id=?').get(id) as { path: string; local_content: string | null; remote_content: string | null } | undefined;
    if (!row) return { ok: false };
    const backup = `冲突备份/${nowForPath()}/${row.path}`;
    const local = this.resolveContent(dto.action, dto.content, row.local_content, row.remote_content);
    const preserved = dto.action === 'keep-local' ? row.remote_content : row.local_content;
    await this.files.write(backup, preserved ?? '');
    const current = await this.files.readText(row.path).catch(() => null);
    await this.files.write(row.path, local ?? '');
    const remoteSha = (this.database.db.prepare('SELECT remote_sha FROM notes WHERE path=?').get(row.path) as { remote_sha?: string } | undefined)?.remote_sha ?? null;
    this.database.db.prepare('INSERT OR REPLACE INTO notes(path,revision,updated_at,remote_sha) VALUES(?,?,?,?)').run(row.path, hash(local ?? ''), now(), remoteSha);
    this.database.db.prepare('DELETE FROM conflicts WHERE id=?').run(id);
    this.record(row.path, current === null ? 'create' : 'update', local ?? '', current);
    return { ok: true, sync: this.status() };
  }

  private resolveContent(action: ConflictAction, content: string | undefined, local: string | null, remote: string | null) {
    if (action === 'use-remote') return remote;
    if (action === 'manual') return content;
    return local;
  }

  private launch(state: SyncState, phase: SyncPhase, task: () => Promise<void>) {
    if (this.active) return;
    this.state = state;
    this.phase = phase;
    this.lastError = '';
    this.currentPath = '';
    this.processedFiles = 0;
    this.totalFiles = 0;
    this.processedBytes = 0;
    this.totalBytes = 0;
    const stamp = now();
    this.jobId = Number(this.database.db.prepare('INSERT INTO sync_jobs(state,phase,error,created_at,updated_at) VALUES(?,?,?,?,?)').run(state, phase, null, stamp, stamp).lastInsertRowid);
    this.active = (async () => {
      try {
        await task();
        this.phase = 'completed';
        this.lastSuccessAt = now();
        this.state = this.count('conflicts') ? 'conflict' : (this.count('pending') ? 'pending' : 'synced');
        this.finishJob(null);
      } catch (error) {
        this.phase = 'failed';
        this.state = 'failed';
        this.lastError = this.errorMessage(error);
        this.database.db.prepare('INSERT INTO sync_runs(state,error,created_at) VALUES(?,?,?)').run(this.state, this.lastError, now());
        this.finishJob(this.lastError);
      } finally {
        this.active = null;
        this.jobId = null;
      }
    })();
  }

  private async initialize() {
    const { fullName, branch } = await this.remote();
    this.phase = 'loading-tree';
    const entries = (await this.github.tree(fullName, branch)).filter((entry) => entry.type === 'blob' && this.paths.allowed(entry.path));
    const tooLarge = entries.find((entry) => (entry.size ?? 0) > 100 * 1024 * 1024);
    if (tooLarge) throw new BadRequestException(`文件超过 GitHub Contents API 的 100MB 限制：${tooLarge.path}`);
    const textEntries = entries.filter((entry) => isText(entry.path));
    this.totalFiles = textEntries.length;
    this.totalBytes = textEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
    this.phase = 'downloading';
    const job = randomBytes(8).toString('hex');
    const staging = join(this.files.dataRoot(), 'staging', job, 'store');
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    const notes = entries.map((entry) => ({ path: entry.path, revision: hash(entry.path), remote_sha: entry.sha, updated_at: now() }));
    let cursor = 0;
    const download = async () => {
      while (true) {
        const index = cursor++;
        if (index >= textEntries.length) return;
        const entry = textEntries[index];
        this.currentPath = entry.path;
        const data = await this.github.raw(fullName, entry.path, branch);
        await this.files.writeIn(staging, entry.path, data);
        notes[entries.indexOf(entry)].revision = hash(data);
        this.processedFiles += 1;
        this.processedBytes += data.byteLength;
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, Math.max(textEntries.length, 1)) }, () => download()));
    this.phase = 'activating';
    try {
      await this.activate(staging, notes);
    } catch (error) {
      await fs.rm(join(this.files.dataRoot(), 'staging', job), { recursive: true, force: true });
      throw error;
    }
    if (this.count('pending')) await this.sync();
  }

  private async sync() {
    const { fullName, branch } = await this.remote();
    this.phase = 'loading-tree';
    const entries = (await this.github.tree(fullName, branch)).filter((entry) => entry.type === 'blob' && this.paths.allowed(entry.path));
    const remote = new Map(entries.map((entry) => [entry.path, entry]));
    const pending = this.database.db.prepare('SELECT path,op,base_blob,base_content,local_content FROM pending ORDER BY updated_at').all() as PendingRow[];
    this.phase = 'uploading';
    this.totalFiles = pending.length;
    for (const row of pending) {
      this.currentPath = row.path;
      await this.pushPending(fullName, branch, remote, row);
      this.processedFiles += 1;
    }
    this.phase = 'refreshing';
    await this.applyRemote(fullName, branch, remote);
  }

  private async remote() {
    this.phase = 'validating-auth';
    await this.github.user();
    this.phase = 'validating-repository';
    const fullName = this.repository.get();
    const meta = await this.github.repository(fullName);
    const branch = meta.default_branch;
    this.repository.setBranch(branch);
    return { fullName, branch };
  }

  private async pushPending(fullName: string, branch: string, remote: Map<string, { path: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }>, row: PendingRow) {
    const entry = remote.get(row.path);
    if (row.op === 'create') {
      if (entry) return this.conflict(fullName, branch, row, entry);
      const sha = await this.github.put(fullName, branch, row.path, row.local_content ?? '');
      remote.set(row.path, { path: row.path, type: 'blob', sha, size: Buffer.byteLength(row.local_content ?? '') });
      this.updateRemoteSha(row.path, sha, row.local_content ?? '');
      this.database.db.prepare('DELETE FROM pending WHERE path=?').run(row.path);
      return;
    }
    if (!entry || entry.sha !== row.base_blob) return this.conflict(fullName, branch, row, entry);
    if (row.op === 'update') {
      const sha = await this.github.put(fullName, branch, row.path, row.local_content ?? '', entry.sha);
      remote.set(row.path, { ...entry, sha, size: Buffer.byteLength(row.local_content ?? '') });
      this.updateRemoteSha(row.path, sha, row.local_content ?? '');
    } else {
      await this.github.remove(fullName, branch, row.path, entry.sha);
      remote.delete(row.path);
    }
    this.database.db.prepare('DELETE FROM pending WHERE path=?').run(row.path);
  }

  private async conflict(fullName: string, branch: string, row: PendingRow, entry?: { sha: string }) {
    const remoteContent = entry ? (await this.github.raw(fullName, row.path, branch)).toString('utf8') : null;
    this.database.db.prepare('INSERT INTO conflicts(id,path,base_content,local_content,remote_content,remote_commit,created_at) VALUES(?,?,?,?,?,?,?)').run(randomBytes(12).toString('hex'), row.path, row.base_content, row.local_content, remoteContent, entry?.sha ?? '', now());
    this.database.db.prepare('DELETE FROM pending WHERE path=?').run(row.path);
  }

  private async applyRemote(fullName: string, branch: string, remote: Map<string, { path: string; sha: string; size?: number }>) {
    const pending = new Set((this.database.db.prepare('SELECT path FROM pending').all() as Array<{ path: string }>).map((row) => row.path));
    const conflicts = new Set((this.database.db.prepare('SELECT path FROM conflicts').all() as Array<{ path: string }>).map((row) => row.path));
    const local = new Map((this.database.db.prepare('SELECT path,revision,remote_sha,updated_at FROM notes').all() as NoteRow[]).map((note) => [note.path, note]));
    const changed = [...remote.values()].filter((entry) => !local.has(entry.path) || local.get(entry.path)?.remote_sha !== entry.sha).filter((entry) => !pending.has(entry.path) && !conflicts.has(entry.path));
    this.totalFiles = Math.max(this.totalFiles, changed.length);
    for (const entry of changed) {
      this.currentPath = entry.path;
      if (!isText(entry.path)) {
        await this.files.remove(entry.path);
        this.database.db.prepare('INSERT OR REPLACE INTO notes(path,revision,updated_at,remote_sha) VALUES(?,?,?,?)').run(entry.path, hash(entry.path), now(), entry.sha);
        this.processedFiles += 1;
        continue;
      }
      const data = await this.github.raw(fullName, entry.path, branch);
      await this.files.write(entry.path, data);
      const content = data.toString('utf8');
      this.database.db.prepare('INSERT OR REPLACE INTO notes(path,revision,updated_at,remote_sha) VALUES(?,?,?,?)').run(entry.path, hash(content || entry.path), now(), entry.sha);
      this.processedFiles += 1;
    }
    for (const path of local.keys()) {
      if (!remote.has(path) && !pending.has(path) && !conflicts.has(path)) {
        await this.files.remove(path);
        this.database.db.prepare('DELETE FROM notes WHERE path=?').run(path);
      }
    }
  }

  private async activate(staging: string, notes: NoteRow[]) {
    const root = this.files.storePath();
    const backup = join(this.files.dataRoot(), 'backup', `store-${Date.now()}`);
    await fs.mkdir(dirname(backup), { recursive: true });
    const hadRoot = existsSync(root);
    try {
      if (hadRoot) await fs.rename(root, backup);
      await fs.rename(staging, root);
    } catch (error) {
      if (hadRoot && !existsSync(root) && existsSync(backup)) await fs.rename(backup, root);
      throw error;
    }
    const pending = this.database.db.prepare('SELECT path,op,base_blob,base_content,local_content FROM pending').all() as PendingRow[];
    const transaction = this.database.db.transaction(() => {
      this.database.db.prepare('DELETE FROM notes').run();
      const insert = this.database.db.prepare('INSERT INTO notes(path,revision,updated_at,remote_sha) VALUES(?,?,?,?)');
      for (const note of notes) insert.run(note.path, note.revision, note.updated_at, note.remote_sha);
      this.repository.markInitialized();
    });
    transaction();
    for (const row of pending) {
      if (row.op === 'delete') {
        await this.files.remove(row.path);
        this.database.db.prepare('DELETE FROM notes WHERE path=?').run(row.path);
      } else {
        await this.files.writeIn(root, row.path, Buffer.from(row.local_content ?? '', 'utf8'));
        const remoteSha = (this.database.db.prepare('SELECT remote_sha FROM notes WHERE path=?').get(row.path) as { remote_sha?: string } | undefined)?.remote_sha ?? null;
        this.database.db.prepare('INSERT OR REPLACE INTO notes(path,revision,updated_at,remote_sha) VALUES(?,?,?,?)').run(row.path, hash(row.local_content ?? ''), now(), remoteSha);
      }
    }
    await fs.rm(join(this.files.dataRoot(), 'git'), { recursive: true, force: true });
  }

  async ensureAsset(path: string) {
    const safe = this.paths.safe(path);
    if (this.files.exists(safe)) return;
    const fullName = this.repository.get();
    if (!fullName || !this.github.hasToken()) throw new UnauthorizedException('请先连接 GitHub');
    let branch = this.repository.branch();
    if (!branch) {
      branch = (await this.github.repository(fullName)).default_branch;
      this.repository.setBranch(branch);
    }
    const data = await this.github.raw(fullName, safe, branch);
    await this.files.write(safe, data);
  }

  private updateRemoteSha(path: string, sha: string, content: string) {
    this.database.db.prepare('INSERT OR REPLACE INTO notes(path,revision,updated_at,remote_sha) VALUES(?,?,?,?)').run(path, hash(content), now(), sha);
  }

  private count(table: 'pending' | 'conflicts') {
    return (this.database.db.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }).c;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : '同步失败';
  }

  private finishJob(error: string | null) {
    if (this.jobId) this.database.db.prepare('UPDATE sync_jobs SET state=?,phase=?,error=?,updated_at=? WHERE id=?').run(this.state, this.phase, error, now(), this.jobId);
  }
}
