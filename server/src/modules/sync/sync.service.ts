import { BadRequestException, Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { hash } from '../../common/crypto.js';
import { isText } from '../../common/file-types.js';
import { noteTitle } from '../../common/note-title.js';
import { now } from '../../common/time.js';
import { DatabaseService } from '../database/database.service.js';
import { GitHubService } from '../github/github.service.js';
import type { TreeEntry } from '../github/contracts/github.types.js';
import { RepositoryService } from '../settings/repository.service.js';
import { FileStoreService } from '../storage/file-store.service.js';
import { PathPolicy } from '../storage/path-policy.service.js';
import type { ConflictAction, SaveConflictDecisionDto } from './contracts/sync.dto.js';
import type { NoteRow, SyncPhase, SyncState, WorkspaceRow } from './contracts/sync.types.js';

type RemoteSnapshot = { head: string; treeSha: string; entries: Map<string, TreeEntry> };
type Claim = Pick<NoteRow, 'id' | 'path' | 'remote_path' | 'content' | 'revision' | 'deleted'>;
const retryDelays = [5_000, 15_000, 30_000, 60_000, 300_000];
const quietSyncDelay = 10 * 60_000;

@Injectable()
export class SyncService implements OnModuleInit {
  private active: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private forceRequested = false;
  private deferredRequested = false;
  private activeForced = false;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PathPolicy) private readonly paths: PathPolicy,
    @Inject(RepositoryService) private readonly repository: RepositoryService,
    @Inject(GitHubService) private readonly github: GitHubService,
    @Inject(FileStoreService) files?: FileStoreService,
  ) { this.files = files ?? new FileStoreService(paths); }

  private readonly files: FileStoreService;

  onModuleInit() {
    void this.bootstrap();
  }

  status() {
    const workspace = this.workspace();
    const dirtyCount = this.countDirty();
    const conflictCount = this.countConflicts();
    const state = this.derivedState(workspace, dirtyCount, conflictCount);
    return {
      state,
      phase: workspace.phase,
      dirtyCount,
      pendingCount: dirtyCount,
      conflictCount,
      currentPath: '', processedFiles: 0, totalFiles: 0, processedBytes: 0, totalBytes: 0,
      resolutionDraftCount: this.countDecisions(), syncBlockedByConflicts: false,
      lastSuccessAt: workspace.verified_at, lastError: workspace.last_error,
      lastRemoteHead: workspace.last_remote_head, verifiedRemoteHead: workspace.verified_remote_head,
      localGeneration: workspace.generation, verifiedGeneration: workspace.verified_generation,
      nextRetryAt: workspace.next_retry_at,
      manualSyncAvailable: !this.active && Boolean(this.repository.get()) && this.github.hasToken(),
    };
  }

  schedule() {
    this.setWorkspace({ state: 'pending', phase: 'idle', last_error: '', next_retry_at: '' });
    if (this.activeForced || this.forceRequested) {
      this.forceRequested = true;
      return;
    }
    this.scheduleQuietSync();
  }

  // 兼容旧调用方；写入已由 NoteService 的 SQLite 事务完成。
  record() { this.schedule(); }

  triggerInitialize() { return this.triggerSync(); }
  reset() { return this.triggerSync(); }

  triggerSync() {
    this.forceRequested = true;
    this.clearQuietTimer();
    this.clearRetryTimer();
    return this.startSync();
  }

  private startSync() {
    if (!this.repository.get()) {
      this.setWorkspace({ state: 'unconfigured', phase: 'idle' });
      return this.status();
    }
    if (!this.github.hasToken()) {
      this.setWorkspace({ state: 'unauthorized', phase: 'idle' });
      return this.status();
    }
    if (this.active) return this.status();
    const forced = this.forceRequested;
    this.forceRequested = false;
    this.deferredRequested = false;
    if (forced) this.clearQuietTimer();
    this.activeForced = forced;
    this.active = this.run(forced).finally(() => {
      this.active = null;
      this.activeForced = false;
      if (this.forceRequested || this.deferredRequested) void this.startSync();
    });
    return this.status();
  }

  async clearWorkspace() {
    this.clearQuietTimer();
    this.clearRetryTimer();
    this.forceRequested = false;
    this.deferredRequested = false;
    this.activeForced = false;
    await this.active;
    await this.files.clear();
    this.database.db.transaction(() => {
      this.database.db.prepare('DELETE FROM notes').run();
      this.database.db.prepare('DELETE FROM pending').run();
      this.database.db.prepare('DELETE FROM conflicts').run();
      this.database.db.prepare('DELETE FROM local_folders').run();
      this.database.db.prepare("UPDATE sync_workspace SET generation=0,verified_generation=-1,last_remote_head='',verified_remote_head='',verified_at='',state='unconfigured',phase='idle',last_error='',next_retry_at='',lock_token='',lock_until='',updated_at='' WHERE id=1").run();
    })();
  }

  conflicts({ cursor, limit, query, review }: { cursor?: string; limit?: string; query?: string; review?: string }) {
    const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50));
    const where = [query?.trim() ? 'path LIKE ?' : '', review === 'decided' ? 'resolution_action IS NOT NULL' : '', review === 'undecided' ? 'resolution_action IS NULL' : ''].filter(Boolean);
    const values: Array<string | number> = query?.trim() ? [`%${query.trim()}%`] : [];
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.database.db.prepare(`SELECT count(*) count FROM conflicts ${filter}`).get(...values) as { count: number }).count;
    const items = this.database.db.prepare(`SELECT id,path,remote_commit,created_at,COALESCE(operation,'update') operation,resolution_action,resolution_copy_path,length(COALESCE(local_content,'')) local_bytes,length(COALESCE(remote_content,'')) remote_bytes FROM conflicts ${filter} ORDER BY created_at,id LIMIT ? OFFSET ?`).all(...values, pageSize, offset);
    return { items, nextCursor: offset + items.length < total ? String(offset + items.length) : null, total, resolutionDraftCount: this.countDecisions() };
  }

  conflictDetail(id: string): any {
    const row = this.database.db.prepare('SELECT * FROM conflicts WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? { ...row, operation: row.operation ?? 'update' } : null;
  }

  saveConflictDecision(id: string, dto: SaveConflictDecisionDto) {
    if (dto.clear) this.database.db.prepare('UPDATE conflicts SET resolution_action=NULL,resolution_content=NULL WHERE id=?').run(id);
    else if (dto.action) this.database.db.prepare('UPDATE conflicts SET resolution_action=?,resolution_content=?,resolution_updated_at=? WHERE id=?').run(dto.action, dto.action === 'manual' ? dto.content ?? '' : null, now(), id);
    else throw new BadRequestException('请选择冲突处理方式');
    return { ok: true, conflict: this.conflictDetail(id), sync: this.status() };
  }

  saveAllConflictDecisions(dto: SaveConflictDecisionDto) {
    if (dto.clear) this.database.db.prepare('UPDATE conflicts SET resolution_action=NULL,resolution_content=NULL').run();
    else if (dto.action && dto.action !== 'manual') this.database.db.prepare('UPDATE conflicts SET resolution_action=?,resolution_content=NULL,resolution_updated_at=?').run(dto.action, now());
    else throw new BadRequestException('请选择自动处理方式');
    return { ok: true, sync: this.status() };
  }

  applyConflictDecisions() {
    const rows = this.database.db.prepare('SELECT * FROM conflicts WHERE resolution_action IS NOT NULL').all() as Array<Record<string, string | null>>;
    for (const row of rows) this.applyDecision(row);
    this.schedule();
    return this.status();
  }

  async ensureAsset(path: string) {
    const safe = this.paths.safe(path);
    if (this.files.exists(safe)) return;
    const fullName = this.repository.get();
    if (!fullName || !this.github.hasToken()) throw new UnauthorizedException('请先连接 GitHub');
    const branch = this.repository.branch() || (await this.github.repository(fullName)).default_branch;
    const data = await this.github.raw(fullName, safe, branch);
    await this.files.write(safe, data);
  }

  private async bootstrap() {
    await this.migrateLegacyRows();
    const row = this.workspace();
    if (row.state === 'syncing') this.setWorkspace({ state: this.countDirty() ? 'pending' : 'checking', phase: 'idle', lock_token: '', lock_until: '' });
    this.triggerSync();
  }

  private async migrateLegacyRows() {
    const rows = this.database.db.prepare('SELECT * FROM notes WHERE id IS NULL OR content IS NULL OR remote_path IS NULL').all() as NoteRow[];
    for (const row of rows) {
      const content = row.content ?? (isText(row.path) ? await this.files.readText(row.path).catch(() => null) : null);
      this.database.db.prepare('UPDATE notes SET id=COALESCE(id,?),content=COALESCE(content,?),revision=CASE WHEN content IS NULL AND ? IS NOT NULL THEN ? ELSE revision END,remote_path=COALESCE(remote_path,path),base_content=COALESCE(base_content,?),title=COALESCE(title,?),dirty=COALESCE(dirty,0),deleted=COALESCE(deleted,0) WHERE path=?').run(randomUUID(), content, content, content === null ? null : hash(content), content, noteTitle(row.path, content ?? ''), row.path);
    }
    const pending = this.database.db.prepare('SELECT path,op,base_content,local_content FROM pending').all() as Array<{ path: string; op: string; base_content: string | null; local_content: string | null }>;
    const mark = this.database.db.transaction(() => {
      for (const item of pending) {
        const existing = this.database.db.prepare('SELECT id FROM notes WHERE path=?').get(item.path) as { id?: string } | undefined;
        if (existing) this.database.db.prepare('UPDATE notes SET content=COALESCE(?,content),base_content=COALESCE(?,base_content),revision=?,dirty=1,deleted=? WHERE path=?').run(item.local_content, item.base_content, hash(item.local_content ?? ''), item.op === 'delete' ? 1 : 0, item.path);
        else this.database.db.prepare('INSERT INTO notes(path,revision,updated_at,remote_sha,title,id,content,remote_path,base_content,dirty,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(item.path, hash(item.local_content ?? ''), now(), null, noteTitle(item.path, item.local_content ?? ''), randomUUID(), item.local_content, null, item.base_content, 1, item.op === 'delete' ? 1 : 0);
      }
      if (pending.length) {
        this.database.db.prepare('DELETE FROM pending').run();
        this.bumpGeneration();
      }
      const invalid = (this.database.db.prepare('SELECT count(*) count FROM notes WHERE id IS NULL OR remote_path IS NULL').get() as { count: number }).count;
      if (invalid) throw new Error('旧笔记迁移校验失败：存在缺少稳定标识或远端路径的记录');
      this.database.db.prepare('INSERT OR REPLACE INTO schema_migrations(version,applied_at) VALUES(2,?)').run(now());
    });
    mark();
  }

  private async run(forced: boolean) {
    const token = randomUUID();
    if (!this.acquireLock(token)) {
      if (forced) this.forceRequested = true;
      this.requestRetry(500);
      return;
    }
    try {
      const { fullName, branch } = await this.remote();
      this.setWorkspace({ state: 'checking', phase: 'fetching', last_error: '', next_retry_at: '' });
      let remote = await this.snapshot(fullName, branch);
      await this.reconcileRemote(fullName, remote);
      const claims = this.claims();
      if (claims.length) {
        this.setWorkspace({ state: 'syncing', phase: 'committing' });
        const committed = await this.commitClaims(fullName, branch, remote, claims);
        if (!committed) {
          this.setWorkspace({ state: 'pending', phase: 'idle' });
          this.requestRetry(0);
          return;
        }
        remote = await this.snapshot(fullName, branch);
        this.setWorkspace({ state: 'syncing', phase: 'verifying', last_remote_head: remote.head });
        await this.verifyAndAcknowledge(fullName, remote, claims);
        await this.reconcileRemote(fullName, remote);
      }
      this.finish(remote.head, forced);
    } catch (error) {
      this.fail(error);
    } finally {
      this.releaseLock(token);
    }
  }

  private async remote() {
    await this.github.user();
    const fullName = this.repository.get();
    const meta = await this.github.repository(fullName);
    this.repository.setBranch(meta.default_branch);
    return { fullName, branch: meta.default_branch };
  }

  private async snapshot(fullName: string, branch: string): Promise<RemoteSnapshot> {
    const head = await this.github.head(fullName, branch);
    const commit = await this.github.commit(fullName, head);
    const entries = (await this.github.tree(fullName, head)).filter((entry) => entry.type === 'blob' && this.paths.allowed(entry.path));
    this.setWorkspace({ last_remote_head: head });
    return { head, treeSha: commit.tree.sha, entries: new Map(entries.map((entry) => [entry.path, entry])) };
  }

  private async reconcileRemote(fullName: string, remote: RemoteSnapshot) {
    this.setWorkspace({ phase: 'merging' });
    const local = this.database.db.prepare('SELECT * FROM notes').all() as NoteRow[];
    const byRemote = new Map(local.filter((note) => note.remote_path).map((note) => [note.remote_path!, note]));
    const localCreates = new Map(local.filter((note) => note.dirty && !note.deleted && !note.remote_path).map((note) => [note.path, note]));
    for (const [path, entry] of remote.entries) {
      const note = byRemote.get(path);
      if (!note) {
        const localCreate = localCreates.get(path);
        if (localCreate) {
          const content = isText(path) ? (await this.github.raw(fullName, path, remote.head)).toString('utf8') : null;
          this.makeConflict(localCreate, content, entry.sha, remote.head);
          continue;
        }
        const content = isText(path) ? (await this.github.raw(fullName, path, remote.head)).toString('utf8') : null;
        this.database.db.prepare('INSERT OR IGNORE INTO notes(path,revision,updated_at,remote_sha,title,id,content,remote_path,base_content,dirty,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run(path, hash(content ?? path), now(), entry.sha, noteTitle(path, content ?? ''), randomUUID(), content, path, content, 0);
        continue;
      }
      if ((note.remote_sha === entry.sha && note.content !== null) || !isText(path)) continue;
      const content = (await this.github.raw(fullName, path, remote.head)).toString('utf8');
      if (note.dirty && note.base_content !== content) this.makeConflict(note, content, entry.sha, remote.head);
      else this.database.db.prepare('UPDATE notes SET path=?,content=?,revision=?,remote_sha=?,remote_path=?,base_content=?,title=?,dirty=0,deleted=0,updated_at=? WHERE id=?').run(path, content, hash(content), entry.sha, path, content, noteTitle(path, content), now(), note.id);
    }
    for (const note of local) {
      if (!note.remote_path || remote.entries.has(note.remote_path)) continue;
      if (note.dirty) this.makeConflict(note, null, '', remote.head);
      else this.database.db.prepare('DELETE FROM notes WHERE id=?').run(note.id);
    }
  }

  private makeConflict(note: NoteRow, remoteContent: string | null, remoteSha: string, remoteHead: string) {
    const copyPath = this.conflictPath(note.path, this.workspace().device_id, note.revision);
    const remotePath = note.remote_path ?? note.path;
    const operation = note.remote_path ? 'update' : 'create';
    const transaction = this.database.db.transaction(() => {
      this.database.db.prepare('INSERT OR IGNORE INTO conflicts(id,path,base_content,local_content,remote_content,remote_commit,created_at,operation,resolution_copy_path) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), note.path, note.base_content, note.content, remoteContent, remoteHead, now(), operation, copyPath);
      if (remoteContent === null) this.database.db.prepare('UPDATE notes SET deleted=1,dirty=0,updated_at=? WHERE id=?').run(now(), note.id);
      else this.database.db.prepare('UPDATE notes SET path=?,content=?,revision=?,remote_path=?,base_content=?,remote_sha=?,dirty=0,deleted=0,title=?,updated_at=? WHERE id=?').run(remotePath, remoteContent, hash(remoteContent), remotePath, remoteContent, remoteSha, noteTitle(remotePath, remoteContent), now(), note.id);
      this.database.db.prepare('INSERT OR IGNORE INTO notes(path,revision,updated_at,remote_sha,title,id,content,remote_path,base_content,dirty,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run(copyPath, note.revision, now(), null, noteTitle(copyPath, note.content ?? ''), randomUUID(), note.content, null, null, 1);
      this.bumpGeneration();
    });
    transaction();
  }

  private async commitClaims(fullName: string, branch: string, remote: RemoteSnapshot, claims: Claim[]) {
    const operations: Array<{ path: string; sha: string | null }> = [];
    for (const claim of claims) {
      if (claim.deleted) {
        if (claim.remote_path && remote.entries.has(claim.remote_path)) operations.push({ path: claim.remote_path, sha: null });
        continue;
      }
      const blob = await this.github.createBlob(fullName, claim.content ?? '');
      operations.push({ path: claim.path, sha: blob });
      if (claim.remote_path && claim.remote_path !== claim.path && remote.entries.has(claim.remote_path)) operations.push({ path: claim.remote_path, sha: null });
    }
    if (!operations.length) return true;
    const tree = await this.github.createTree(fullName, remote.treeSha, operations);
    const commit = await this.github.createCommit(fullName, `noteai: sync ${claims.length} note${claims.length > 1 ? 's' : ''}`, tree, remote.head);
    return this.github.updateRef(fullName, branch, commit);
  }

  private async verifyAndAcknowledge(fullName: string, remote: RemoteSnapshot, claims: Claim[]) {
    const verified = new Map<string, { sha: string; content: string }>();
    for (const claim of claims) {
      const entry = remote.entries.get(claim.path);
      if (claim.deleted) {
        if (claim.remote_path && remote.entries.has(claim.remote_path)) continue;
        verified.set(claim.id, { sha: '', content: '' });
      } else if (entry) {
        const remoteContent = (await this.github.raw(fullName, claim.path, remote.head)).toString('utf8');
        if (hash(remoteContent) === claim.revision) verified.set(claim.id, { sha: entry.sha, content: remoteContent });
      }
    }
    const acknowledge = this.database.db.transaction(() => {
      for (const claim of claims) {
        if (!verified.has(claim.id)) continue;
        if (claim.deleted) this.database.db.prepare('DELETE FROM notes WHERE id=? AND revision=? AND dirty=1 AND deleted=1').run(claim.id, claim.revision);
        else {
          const acknowledged = verified.get(claim.id)!;
          const clean = this.database.db.prepare('UPDATE notes SET dirty=0,remote_path=path,remote_sha=?,base_content=content,updated_at=? WHERE id=? AND revision=? AND dirty=1 AND deleted=0').run(acknowledged.sha, now(), claim.id, claim.revision);
          if (!clean.changes) this.database.db.prepare('UPDATE notes SET remote_path=?,remote_sha=?,base_content=?,updated_at=? WHERE id=? AND revision<>? AND dirty=1 AND deleted=0').run(claim.path, acknowledged.sha, acknowledged.content, now(), claim.id, claim.revision);
        }
      }
    });
    acknowledge();
  }

  private finish(head: string, forced: boolean) {
    const dirty = this.countDirty();
    const conflicts = this.countConflicts();
    const workspace = this.workspace();
    if (conflicts) this.setWorkspace({ state: 'conflict', phase: 'completed', last_remote_head: head });
    else if (dirty) {
      this.setWorkspace({ state: 'pending', phase: 'idle', last_remote_head: head });
      if (forced) this.forceRequested = true;
      else this.ensureQuietSync();
    }
    else this.setWorkspace({ state: 'verified', phase: 'completed', last_remote_head: head, verified_remote_head: head, verified_generation: workspace.generation, verified_at: now(), last_error: '', next_retry_at: '' });
  }

  private fail(error: unknown) {
    const attempts = (this.database.db.prepare("SELECT count(*) count FROM sync_runs WHERE state='failed'").get() as { count: number }).count;
    const delay = retryDelays[Math.min(attempts, retryDelays.length - 1)];
    const next = new Date(Date.now() + delay).toISOString();
    const message = error instanceof Error ? error.message : '同步失败';
    this.setWorkspace({ state: this.countConflicts() ? 'conflict' : 'failed', phase: 'failed', last_error: message, next_retry_at: next });
    this.database.db.prepare('INSERT INTO sync_runs(state,error,created_at) VALUES(?,?,?)').run('failed', message, now());
    this.requestRetry(delay);
  }

  private requestRetry(delay: number) {
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.deferredRequested = true;
      void this.startSync();
    }, delay);
  }

  private scheduleQuietSync() {
    this.clearQuietTimer();
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.deferredRequested = true;
      void this.startSync();
    }, quietSyncDelay);
  }

  private ensureQuietSync() {
    if (!this.quietTimer && !this.deferredRequested) this.scheduleQuietSync();
  }

  private clearQuietTimer() {
    if (!this.quietTimer) return;
    clearTimeout(this.quietTimer);
    this.quietTimer = null;
  }

  private clearRetryTimer() {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private applyDecision(row: Record<string, string | null>) {
    const action = row.resolution_action as ConflictAction;
    const copy = row.resolution_copy_path;
    if (action === 'use-remote' && copy) this.database.db.prepare('UPDATE notes SET dirty=1,deleted=1,revision=?,updated_at=? WHERE path=?').run(hash(`delete:${copy}:${now()}`), now(), copy);
    if ((action === 'keep-local' || action === 'manual') && copy) {
      const local = this.database.db.prepare('SELECT * FROM notes WHERE path=? AND deleted=0').get(copy) as NoteRow | undefined;
      const content = action === 'manual' ? row.resolution_content ?? '' : local?.content ?? row.local_content ?? '';
      const original = this.database.db.prepare('SELECT id FROM notes WHERE path=? AND deleted=0').get(row.path) as { id: string } | undefined;
      if (original) this.database.db.prepare('UPDATE notes SET content=?,revision=?,title=?,dirty=1,deleted=0,updated_at=? WHERE id=?').run(content, hash(content), noteTitle(row.path ?? '', content), now(), original.id);
      if (local) this.database.db.prepare('UPDATE notes SET deleted=1,dirty=1,revision=?,updated_at=? WHERE id=?').run(hash(`delete:${local.id}:${now()}`), now(), local.id);
    }
    this.database.db.prepare('DELETE FROM conflicts WHERE id=?').run(row.id);
  }

  private claims() {
    return this.database.db.prepare('SELECT id,path,remote_path,content,revision,deleted FROM notes WHERE dirty=1 ORDER BY updated_at,id').all() as Claim[];
  }

  private conflictPath(path: string, device: string, revision: string) {
    const extension = extname(path) || '.md';
    const directory = dirname(path);
    const name = path.slice(directory === '.' ? 0 : directory.length + 1, -extension.length);
    return `${directory === '.' ? '' : `${directory}/`}${name}（冲突-${device.slice(0, 6)}-${revision.slice(0, 8)}）${extension}`;
  }

  private workspace() {
    return this.database.db.prepare('SELECT * FROM sync_workspace WHERE id=1').get() as WorkspaceRow;
  }

  private setWorkspace(values: Partial<WorkspaceRow>) {
    const entries = Object.entries({ ...values, updated_at: now() });
    this.database.db.prepare(`UPDATE sync_workspace SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=1`).run(...entries.map(([, value]) => value));
  }

  private bumpGeneration() { this.database.db.prepare('UPDATE sync_workspace SET generation=generation+1,updated_at=? WHERE id=1').run(now()); }
  private countDirty() { return (this.database.db.prepare('SELECT count(*) count FROM notes WHERE dirty=1').get() as { count: number }).count; }
  private countConflicts() { return (this.database.db.prepare('SELECT count(*) count FROM conflicts').get() as { count: number }).count; }
  private countDecisions() { return (this.database.db.prepare('SELECT count(*) count FROM conflicts WHERE resolution_action IS NOT NULL').get() as { count: number }).count; }
  private derivedState(workspace: WorkspaceRow, dirty: number, conflicts: number): SyncState {
    if (!this.repository.get()) return 'unconfigured';
    if (!this.github.hasToken()) return 'unauthorized';
    if (workspace.lock_until && workspace.lock_until > now()) return workspace.phase === 'fetching' ? 'checking' : 'syncing';
    if (conflicts) return 'conflict';
    if (dirty) return workspace.state === 'failed' ? 'failed' : 'pending';
    return workspace.verified_generation === workspace.generation && workspace.verified_remote_head ? 'verified' : 'checking';
  }

  private acquireLock(token: string) {
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    const result = this.database.db.prepare("UPDATE sync_workspace SET lock_token=?,lock_until=?,state='checking',phase='fetching',updated_at=? WHERE id=1 AND (lock_until='' OR lock_until<?)").run(token, until, now(), now());
    return result.changes === 1;
  }
  private releaseLock(token: string) { this.database.db.prepare("UPDATE sync_workspace SET lock_token='',lock_until='',updated_at=? WHERE id=1 AND lock_token=?").run(now(), token); }
}
