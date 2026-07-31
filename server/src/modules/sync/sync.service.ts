import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { isText } from '../../common/file-types.js';
import { now } from '../../common/time.js';
import { DatabaseService } from '../database/database.service.js';
import { GitHubService } from '../github/github.service.js';
import { RepositoryService } from '../settings/repository.service.js';
import { GitProcessService } from '../storage/git-process.service.js';
import { PathPolicy } from '../storage/path-policy.service.js';
import { FileIndexRow, RepositoryWorkspaceService } from '../storage/repository-workspace.service.js';
import type { ConflictAction, SaveConflictDecisionDto } from './contracts/sync.dto.js';
import type { RepositoryStateRow, SyncState, SyncStatus } from './contracts/sync.types.js';

export type TreeOperation =
  | { type: 'create-folder'; path: string }
  | { type: 'move-file'; id: string; fromPath: string; toFolder: string; revision: string }
  | { type: 'move-folder' | 'rename-folder'; fromPath: string; toPath: string }
  | { type: 'delete-file'; id: string; path: string; revision: string }
  | { type: 'delete-folder'; path: string; recursive?: boolean };

export type ManagementCommit = {
  operations: TreeOperation[];
  idByPath: Map<string, string>;
  baseGeneration: number;
  expectedFiles: Array<Pick<FileIndexRow, 'id' | 'path' | 'revision'>>;
};

type JobType = 'sync' | 'management';
const quietSyncDelay = 10 * 60_000;
const cloneTimeout = 2 * 60 * 60_000;

@Injectable()
export class SyncService implements OnModuleInit {
  private active: Promise<unknown> | null = null;
  private writes = 0;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PathPolicy) private readonly paths: PathPolicy,
    @Inject(RepositoryService) private readonly repository: RepositoryService,
    @Inject(GitHubService) private readonly github: GitHubService,
    @Inject(GitProcessService) private readonly git: GitProcessService,
    @Inject(RepositoryWorkspaceService) private readonly workspace: RepositoryWorkspaceService,
  ) {}

  async onModuleInit() {
    await this.bootstrap();
  }

  status(): SyncStatus {
    const row = this.state();
    const conflictCount = this.countConflicts();
    let state = row.state;
    if (!row.repository) state = 'unconfigured';
    else if (!this.github.hasToken()) state = 'unauthorized';
    else if (conflictCount && !this.active && row.state !== 'checking' && row.state !== 'syncing') state = 'conflict';
    return {
      state,
      phase: row.phase,
      dirtyCount: row.dirty_count,
      conflictCount,
      generation: row.generation,
      verifiedGeneration: row.verified_generation,
      remoteHead: row.remote_head,
      verifiedAt: row.verified_at,
      activityStartedAt: row.updated_at,
      lastError: row.last_error,
      manualSyncAvailable: !this.active && this.writes === 0 && Boolean(row.repository) && this.github.hasToken() && !conflictCount,
    };
  }

  assertWritable() {
    if (this.active || this.writes > 0 || this.state().lock_token) {
      throw new HttpException({ code: 'SYNC_BUSY', message: '同步正在更新 Git 工作区，请稍后重试' }, 423);
    }
    if (!this.workspace.exists()) throw new ConflictException({ code: 'WORKSPACE_NOT_READY', message: 'Git 工作区尚未初始化' });
  }

  async write<T>(work: () => Promise<T>) {
    this.assertWritable();
    this.writes += 1;
    try {
      return await work();
    } finally {
      this.writes -= 1;
    }
  }

  async markDirty() {
    const status = await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: this.workspace.root });
    const dirtyCount = this.workspace.parseStatus(status).length;
    this.database.db.prepare("UPDATE repository_state SET generation=generation+1,dirty_count=?,state='pending',phase='idle',last_error='',updated_at=? WHERE id=1").run(dirtyCount, now());
    this.schedule();
  }

  schedule() {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.triggerSync();
    }, quietSyncDelay);
  }

  async reset() {
    if (this.writes > 0) throw new HttpException({ code: 'SYNC_BUSY', message: '文件正在保存，请稍后重试' }, 423);
    this.git.cancelActive();
    const active = this.active;
    if (active) await active.catch(() => undefined);
    await this.discardIncompleteRepository();
    return this.status();
  }

  triggerSync() {
    if (!this.repository.get()) {
      this.setState({ state: 'unconfigured', phase: 'idle' });
      return this.status();
    }
    if (!this.github.hasToken()) {
      this.setState({ state: 'unauthorized', phase: 'idle' });
      return this.status();
    }
    if (!this.workspace.exists() || !this.repository.branch()) {
      void this.discardIncompleteRepository().catch(() => undefined);
      return this.status();
    }
    if (this.countConflicts()) {
      this.setState({ state: 'conflict', phase: 'idle' });
      return this.status();
    }
    if (this.writes > 0) {
      throw new HttpException({ code: 'SYNC_BUSY', message: '文件正在保存，请稍后重试同步' }, 423);
    }
    if (this.active) return this.status();
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    const needsInitialization = !this.workspace.exists() || !this.repository.branch();
    this.setState({ state: 'checking', phase: needsInitialization ? 'cloning' : 'fetching', last_error: '' });
    void this.exclusive(() => this.runSync()).catch(() => undefined);
    return this.status();
  }

  async selectRepository(value: string) {
    if (this.active || this.writes > 0) throw new HttpException({ code: 'SYNC_BUSY', message: '同步正在进行，请稍后重试' }, 423);
    const current = this.state();
    const normalized = value.trim().replace(/\/$/, '').replace(/\.git$/, '').replace(/^(?:git@github\.com:|https:\/\/github\.com\/)/, '');
    const workingChanges = current.repository && current.repository !== normalized && this.workspace.exists()
      ? this.workspace.parseStatus(await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: this.workspace.root })).length
      : 0;
    if (current.repository && current.repository !== normalized && (current.dirty_count > 0 || workingChanges > 0 || this.countConflicts() > 0)) {
      throw new ConflictException({ code: 'LOCAL_CHANGES', message: '当前仓库存在未同步修改或未处理冲突，不能切换仓库' });
    }
    const repository = this.repository.set(value);
    this.setState({ state: 'checking', phase: 'checking-repository', last_error: '' });
    void this.exclusive(() => this.initialize()).catch((reason) => this.fail(reason));
    return { repository, sync: this.status() };
  }

  async clearWorkspace() {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (this.writes > 0) throw new HttpException({ code: 'SYNC_BUSY', message: '文件正在保存，请稍后重试' }, 423);
    if (this.active) await this.active;
    await this.workspace.clear();
    await fs.rm(join(this.workspace.jobsRoot, 'conflicts'), { recursive: true, force: true });
    this.database.db.transaction(() => {
      this.database.db.prepare('DELETE FROM conflicts').run();
      this.database.db.prepare('DELETE FROM sync_jobs').run();
    })();
  }

  async commitManagementTree(change: ManagementCommit) {
    if (this.active) throw new HttpException({ code: 'SYNC_BUSY', message: '同步正在进行，请稍后重试' }, 423);
    return this.exclusive(() => this.runManagement(change));
  }

  conflicts({ cursor, limit, query, review }: { cursor?: string; limit?: string; query?: string; review?: string }) {
    const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50));
    const where = [query?.trim() ? 'path LIKE ?' : '', review === 'decided' ? 'resolution_action IS NOT NULL' : '', review === 'undecided' ? 'resolution_action IS NULL' : ''].filter(Boolean);
    const values: string[] = query?.trim() ? [`%${query.trim()}%`] : [];
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.database.db.prepare(`SELECT count(*) count FROM conflicts ${filter}`).get(...values) as { count: number }).count;
    const rows = this.database.db.prepare(`SELECT id,path,remote_commit,created_at,operation,resolution_action,copy_path,kind FROM conflicts ${filter} ORDER BY created_at,id LIMIT ? OFFSET ?`).all(...values, pageSize, offset) as Array<Record<string, string | null>>;
    const items = rows.map((row) => ({
      ...row,
      resolution_copy_path: row.copy_path,
      local_bytes: this.artifactSize(row.id as string, 'local'),
      remote_bytes: this.artifactSize(row.id as string, 'remote'),
    }));
    return { items, nextCursor: offset + items.length < total ? String(offset + items.length) : null, total, resolutionDraftCount: this.countDecisions() };
  }

  async conflictDetail(id: string) {
    const row = this.database.db.prepare('SELECT * FROM conflicts WHERE id=?').get(id) as Record<string, string | null> | undefined;
    if (!row) return null;
    const text = row.kind === 'markdown' || row.kind === 'text';
    return {
      ...row,
      resolution_copy_path: row.copy_path,
      base_content: text ? await this.readArtifact(row.base_file) : null,
      local_content: text ? await this.readArtifact(row.local_file) : null,
      remote_content: text ? await this.readArtifact(row.remote_file) : null,
      local_bytes: this.artifactSize(id, 'local'),
      remote_bytes: this.artifactSize(id, 'remote'),
    };
  }

  async saveConflictDecision(id: string, dto: SaveConflictDecisionDto) {
    if (!this.database.db.prepare('SELECT 1 FROM conflicts WHERE id=?').get(id)) throw new NotFoundException('冲突不存在');
    if (dto.clear) this.database.db.prepare('UPDATE conflicts SET resolution_action=NULL,resolution_content=NULL,resolution_updated_at=NULL WHERE id=?').run(id);
    else if (dto.action) this.database.db.prepare('UPDATE conflicts SET resolution_action=?,resolution_content=?,resolution_updated_at=? WHERE id=?').run(dto.action, dto.action === 'manual' ? dto.content ?? '' : null, now(), id);
    else throw new BadRequestException('请选择冲突处理方式');
    return { ok: true, conflict: await this.conflictDetail(id), sync: this.status() };
  }

  saveAllConflictDecisions(dto: SaveConflictDecisionDto) {
    if (dto.clear) this.database.db.prepare('UPDATE conflicts SET resolution_action=NULL,resolution_content=NULL,resolution_updated_at=NULL').run();
    else if (dto.action && dto.action !== 'manual') this.database.db.prepare('UPDATE conflicts SET resolution_action=?,resolution_content=NULL,resolution_updated_at=?').run(dto.action, now());
    else throw new BadRequestException('请选择自动处理方式');
    return { ok: true, sync: this.status() };
  }

  async applyConflictDecisions() {
    if (this.active) throw new HttpException({ code: 'SYNC_BUSY', message: '同步正在进行，请稍后重试' }, 423);
    const rows = this.database.db.prepare('SELECT * FROM conflicts WHERE resolution_action IS NOT NULL').all() as Array<Record<string, string | null>>;
    if (!rows.length) return this.status();
    this.assertWritable();
    await this.exclusive(async () => {
      for (const row of rows) await this.applyDecision(row);
      this.database.db.prepare(`DELETE FROM conflicts WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map((row) => row.id));
      await Promise.all(rows.map((row) => fs.rm(join(this.workspace.jobsRoot, 'conflicts', row.id ?? ''), { recursive: true, force: true })));
      await this.markDirty();
    });
    this.triggerSync();
    return this.status();
  }

  private async bootstrap() {
    await this.workspace.prepareRoots();
    this.database.db.prepare("UPDATE repository_state SET lock_token='',updated_at=? WHERE id=1").run(now());
    await this.recoverJobs();
    if (this.repository.get() && (!this.workspace.exists() || !this.repository.branch())) await this.discardIncompleteRepository();
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.active || this.writes > 0) throw new HttpException({ code: 'SYNC_BUSY', message: '同步正在进行，请稍后重试' }, 423);
    const token = randomUUID();
    const claimed = this.database.db.prepare("UPDATE repository_state SET lock_token=?,updated_at=? WHERE id=1 AND lock_token='' ").run(token, now());
    if (!claimed.changes) throw new HttpException({ code: 'SYNC_BUSY', message: '同步正在进行，请稍后重试' }, 423);
    const promise = work();
    this.active = promise;
    try {
      return await promise;
    } finally {
      this.database.db.prepare('UPDATE repository_state SET lock_token=?,updated_at=? WHERE id=1 AND lock_token=?').run('', now(), token);
      this.active = null;
    }
  }

  private async initialize() {
    const fullName = this.repository.get();
    if (!fullName) return;
    const token = this.github.accessToken();
    try {
      this.setState({ state: 'checking', phase: 'checking-repository', last_error: '' });
      const meta = await this.github.repository(fullName);
      const storedBranch = this.repository.branch();
      if (storedBranch && storedBranch !== meta.default_branch) {
        throw new ConflictException({ code: 'DEFAULT_BRANCH_CHANGED', message: 'GitHub 默认分支已变化，请断开后重新选择仓库' });
      }
      const branch = storedBranch || meta.default_branch || 'main';
      const cloneUrl = this.github.cloneUrl(fullName);
      this.setState({ state: 'checking', phase: 'checking-remote' });
      const remoteHead = await this.lsRemoteUrl(cloneUrl, branch, token);
      this.setState({ state: 'checking', phase: 'preparing-workspace' });
      await this.workspace.clear();
      if (remoteHead) {
        this.setState({ state: 'checking', phase: 'cloning' });
        await this.git.run(['clone', '--depth=1', '--single-branch', '--no-tags', '--branch', branch, '--', cloneUrl, this.workspace.root], { cwd: this.workspace.jobsRoot, token, timeout: cloneTimeout });
      } else {
        await fs.mkdir(this.workspace.root, { recursive: true });
        await this.git.run(['init', `--initial-branch=${branch}`], { cwd: this.workspace.root });
        await this.git.run(['remote', 'add', 'origin', cloneUrl], { cwd: this.workspace.root });
      }
      this.setState({ state: 'checking', phase: 'configuring-workspace' });
      await this.configureIdentity();
      await this.assertRepositorySafety();
      this.setState({ state: 'checking', phase: 'indexing-workspace' });
      await this.workspace.rebuildIndex();
      const head = await this.head();
      this.repository.bind(fullName, branch, head || remoteHead);
    } catch (reason) {
      await this.discardIncompleteRepository();
      throw reason;
    }
  }

  private async runSync(retry = 0): Promise<void> {
    if (!this.workspace.exists() || !this.repository.branch()) {
      await this.discardIncompleteRepository();
      return;
    }
    const jobId = this.createJob('sync', []);
    const state = this.state();
    let base = '';
    let snapshot = '';
    try {
      await this.assertRepositorySafety();
      base = await this.head();
      const status = await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: this.workspace.root });
      const observedChanges = this.workspace.parseStatus(status);
      if (observedChanges.length && state.dirty_count === 0) {
        this.database.db.prepare('UPDATE repository_state SET generation=generation+1,dirty_count=?,updated_at=? WHERE id=1').run(observedChanges.length, now());
      }
      const changes = await this.workspace.assertSupportedWorkingChanges(status);
      const stagePaths = [...new Set(changes.flatMap((entry) => entry.paths))];
      await this.assertSafeStagePaths(stagePaths);
      if (stagePaths.length) {
        this.setState({ state: 'syncing', phase: 'committing', last_error: '' });
        await this.git.run(['add', '--all', '--', ...stagePaths], { cwd: this.workspace.root });
        if (await this.hasStagedChanges()) {
          await this.commit('noteai: sync local changes');
          snapshot = await this.head();
          await this.keepJobRef(jobId, snapshot);
          this.updateJob(jobId, { snapshot_commit: snapshot, phase: 'snapshot' });
        }
      }

      this.setState({ state: 'checking', phase: 'fetching' });
      const remoteHead = await this.fetchRemote();
      let candidate = snapshot || base;
      const remoteAdvanced = Boolean(remoteHead && remoteHead !== base);
      if (!snapshot && remoteAdvanced) {
        await this.git.run(['reset', '--hard', remoteHead], { cwd: this.workspace.root });
        candidate = remoteHead;
      } else if (snapshot && remoteAdvanced) {
        this.setState({ state: 'syncing', phase: 'merging' });
        await this.git.run(['reset', '--hard', remoteHead], { cwd: this.workspace.root });
        candidate = await this.cherryPickWithConflicts(snapshot, base, remoteHead, jobId);
      }

      if (candidate && candidate !== remoteHead) {
        this.updateJob(jobId, { candidate_commit: candidate, phase: 'pushing' });
        this.setState({ state: 'syncing', phase: 'pushing' });
        await this.pushAndVerify(candidate, remoteHead);
      } else {
        await this.verifyRemote(candidate);
      }

      const verifiedHead = candidate || remoteHead;
      await this.finishVerified(verifiedHead, remoteAdvanced);
      this.completeJob(jobId);
    } catch (reason) {
      if (snapshot) await this.restoreDirty(base, snapshot).catch(() => undefined);
      await this.discardJobConflicts(jobId);
      this.failJob(jobId, reason);
      if (retry < 1 && this.errorCode(reason) === 'PUSH_RACE') {
        return this.runSync(retry + 1);
      }
      this.fail(reason);
      throw reason;
    }
  }

  private async runManagement(change: ManagementCommit) {
    const jobId = this.createJob('management', change.operations);
    const beforeState = this.state();
    let base = '';
    let snapshot = '';
    let mutated = false;
    let reconciledRemote = false;
    try {
      const actualFiles = this.workspace.indexRows().map(({ id, path, revision }) => ({ id, path, revision }));
      if (beforeState.generation !== change.baseGeneration || JSON.stringify(actualFiles) !== JSON.stringify(change.expectedFiles)) {
        throw new ConflictException({ code: 'TREE_VERSION_STALE', message: '文件结构已变化，请刷新后重新整理' });
      }
      await this.assertRepositorySafety();
      base = await this.head();
      if (base !== beforeState.local_head) throw new ConflictException({ code: 'LOCAL_HEAD_CHANGED', message: '本地 Git 基线已变化，请刷新后重试' });
      this.setState({ state: 'checking', phase: 'fetching', last_error: '' });
      const remoteHead = await this.fetchRemote();
      if (remoteHead !== beforeState.remote_head) {
        await this.runSync();
        reconciledRemote = true;
        throw new ConflictException({ code: 'REMOTE_CHANGED', message: 'GitHub 文件结构已变化，请刷新后重新操作' });
      }

      const status = await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: this.workspace.root });
      const existingChanges = await this.workspace.assertSupportedWorkingChanges(status);
      const existingPaths = [...new Set(existingChanges.flatMap((entry) => entry.paths))];
      await this.assertSafeStagePaths(existingPaths);
      if (existingPaths.length) {
        await this.git.run(['add', '--all', '--', ...existingPaths], { cwd: this.workspace.root });
        if (await this.hasStagedChanges()) {
          await this.commit('noteai: management snapshot');
          snapshot = await this.head();
          await this.keepJobRef(jobId, snapshot);
          this.updateJob(jobId, { snapshot_commit: snapshot, phase: 'snapshot' });
        }
      }
      if (!snapshot) {
        snapshot = base;
        if (snapshot) {
          await this.keepJobRef(jobId, snapshot);
          this.updateJob(jobId, { snapshot_commit: snapshot, phase: 'snapshot' });
        }
      }

      this.setState({ state: 'syncing', phase: 'committing' });
      mutated = change.operations.length > 0;
      for (const operation of change.operations) await this.applyTreeOperation(operation);
      const finalStatus = await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: this.workspace.root });
      const finalChanges = await this.workspace.assertSupportedWorkingChanges(finalStatus);
      const finalPaths = [...new Set(finalChanges.flatMap((entry) => entry.paths))];
      await this.assertSafeStagePaths(finalPaths);
      if (finalPaths.length) await this.git.run(['add', '--all', '--', ...finalPaths], { cwd: this.workspace.root });

      let candidate = base;
      if (base) {
        await this.git.run(['reset', '--soft', base], { cwd: this.workspace.root });
        if (await this.hasStagedChanges()) {
          await this.commit(`noteai: organize ${change.operations.length} item${change.operations.length === 1 ? '' : 's'}`);
          candidate = await this.head();
        }
      } else if (snapshot) {
        if (await this.hasStagedChanges()) await this.git.run(['commit', '--amend', '--no-edit'], { cwd: this.workspace.root });
        candidate = await this.head();
      } else if (await this.hasStagedChanges()) {
        await this.commit(`noteai: organize ${change.operations.length} item${change.operations.length === 1 ? '' : 's'}`);
        candidate = await this.head();
      }

      if (candidate && candidate !== remoteHead) {
        this.updateJob(jobId, { candidate_commit: candidate, phase: 'pushing' });
        this.setState({ state: 'syncing', phase: 'pushing' });
        await this.pushAndVerify(candidate, remoteHead);
      } else {
        await this.verifyRemote(candidate);
      }
      await this.workspace.rebuildIndex(change.idByPath);
      const generation = beforeState.generation + 1;
      this.database.db.prepare("UPDATE repository_state SET local_head=?,remote_head=?,generation=?,verified_generation=?,dirty_count=0,state='verified',phase='completed',last_error='',verified_at=?,updated_at=? WHERE id=1").run(candidate, candidate, generation, generation, now(), now());
      this.completeJob(jobId);
      return this.status();
    } catch (reason) {
      if (mutated || (snapshot && snapshot !== base)) await this.restoreDirty(base, snapshot).catch(() => undefined);
      await this.workspace.rebuildIndex().catch(() => undefined);
      this.failJob(jobId, reason);
      if (!(reconciledRemote && this.errorCode(reason) === 'REMOTE_CHANGED')) this.fail(reason);
      throw reason;
    }
  }

  private async applyTreeOperation(operation: TreeOperation) {
    if (operation.type === 'create-folder') return this.workspace.createFolder(operation.path);
    if (operation.type === 'move-file') {
      const folder = operation.toFolder ? `${this.paths.safeFolder(operation.toFolder)}/` : '';
      const target = `${folder}${basename(operation.fromPath)}`;
      if (target === operation.fromPath) return;
      return this.workspace.moveFile(operation.fromPath, target);
    }
    if (operation.type === 'move-folder' || operation.type === 'rename-folder') {
      await this.workspace.assertManagedFolder(operation.fromPath);
      return this.workspace.moveFolder(operation.fromPath, operation.toPath);
    }
    if (operation.type === 'delete-file') return this.workspace.removeFile(operation.path);
    if (operation.type === 'delete-folder') {
      await this.workspace.assertManagedFolder(operation.path);
      return this.workspace.removeFolder(operation.path);
    }
  }

  private async fetchRemote() {
    const branch = this.repository.branch();
    const token = this.github.accessToken();
    const remote = await this.lsRemote(branch, token);
    if (remote) await this.git.run(['fetch', '--no-tags', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: this.workspace.root, token });
    return remote;
  }

  private async pushAndVerify(candidate: string, expectedRemote: string) {
    const branch = this.repository.branch();
    const token = this.github.accessToken();
    try {
      await this.git.run(['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: this.workspace.root, token });
    } catch (reason) {
      const actual = await this.lsRemote(branch, token).catch(() => '');
      if (actual === candidate) return;
      if (actual !== expectedRemote) throw new ConflictException({ code: 'PUSH_RACE', message: 'GitHub 在 push 前发生变化，本地修改已恢复并重新同步' });
      throw reason;
    }
    this.setState({ state: 'syncing', phase: 'verifying' });
    const verified = await this.lsRemote(branch, token);
    if (verified !== candidate) throw new ConflictException({ code: 'REMOTE_VERIFY_FAILED', message: 'GitHub 远端 ref 校验失败，本次同步未确认成功' });
  }

  private async verifyRemote(candidate: string) {
    const actual = await this.lsRemote(this.repository.branch(), this.github.accessToken());
    if (actual !== candidate) throw new ConflictException({ code: 'PUSH_RACE', message: 'GitHub 在同步期间发生变化，本地状态未标记为已验证' });
  }

  private async cherryPickWithConflicts(snapshot: string, base: string, remote: string, jobId: string) {
    try {
      await this.git.run(['cherry-pick', snapshot], { cwd: this.workspace.root });
      return this.head();
    } catch (reason) {
      const output = await this.git.run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: this.workspace.root }).catch(() => '');
      const paths = output.split('\0').filter(Boolean);
      if (!paths.length) throw reason;
      for (const path of paths) await this.resolveGitConflict(path, base, snapshot, remote, jobId);
      await this.git.run(['cherry-pick', '--continue'], { cwd: this.workspace.root });
      return this.head();
    }
  }

  private async resolveGitConflict(path: string, base: string, local: string, remote: string, jobId: string) {
    const safe = this.paths.safe(path);
    const id = randomUUID();
    const root = join(this.workspace.jobsRoot, 'conflicts', id);
    await fs.mkdir(root, { recursive: true });
    const baseFile = await this.checkoutStage(1, safe, join(root, 'base'));
    const remoteFile = await this.checkoutStage(2, safe, join(root, 'remote'));
    const localFile = await this.checkoutStage(3, safe, join(root, 'local'));
    const copyPath = localFile ? await this.conflictCopyPath(safe, id) : '';

    if (remoteFile) await this.git.run(['checkout', '--ours', '--', safe], { cwd: this.workspace.root });
    else await this.git.run(['rm', '--ignore-unmatch', '--', safe], { cwd: this.workspace.root });
    if (localFile && copyPath) {
      await this.workspace.writeAtomic(copyPath, await fs.readFile(localFile));
      await this.git.run(['add', '--', copyPath], { cwd: this.workspace.root });
    }
    await this.git.run(['add', '--all', '--', safe], { cwd: this.workspace.root });
    const kind = this.workspace.indexByPath(safe)?.kind ?? (isText(safe) ? 'text' : extname(safe).slice(1));
    this.database.db.prepare('INSERT INTO conflicts(id,job_id,path,copy_path,base_commit,local_commit,remote_commit,base_file,local_file,remote_file,kind,operation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, jobId, safe, copyPath, base, local, remote,
      baseFile ? this.artifactRelative(baseFile) : '', localFile ? this.artifactRelative(localFile) : '', remoteFile ? this.artifactRelative(remoteFile) : '',
      kind, !remoteFile ? 'create' : !localFile ? 'delete' : 'update', now(),
    );
  }

  private async checkoutStage(stage: 1 | 2 | 3, path: string, root: string) {
    await fs.mkdir(root, { recursive: true });
    try {
      await this.git.run(['checkout-index', `--stage=${stage}`, `--prefix=${root}/`, '--', path], { cwd: this.workspace.root });
      const target = join(root, path);
      return existsSync(target) ? target : '';
    } catch {
      return '';
    }
  }

  private async applyDecision(row: Record<string, string | null>) {
    const action = row.resolution_action as ConflictAction;
    const path = this.paths.safe(row.path ?? '');
    const copyPath = row.copy_path ? this.paths.safe(row.copy_path) : '';
    const localFile = row.local_file ? join(this.workspace.jobsRoot, row.local_file) : '';
    if (action === 'keep-local') {
      if (localFile && existsSync(localFile)) await this.workspace.writeAtomic(path, await fs.readFile(localFile));
      else if (this.workspace.indexByPath(path)) await this.workspace.removeFile(path);
      if (copyPath && this.workspace.indexByPath(copyPath)) await this.workspace.removeFile(copyPath);
    } else if (action === 'use-remote') {
      if (copyPath && this.workspace.indexByPath(copyPath)) await this.workspace.removeFile(copyPath);
    } else if (action === 'manual') {
      if (!isText(path)) throw new BadRequestException('二进制冲突不支持手动编辑');
      await this.workspace.writeAtomic(path, Buffer.from(row.resolution_content ?? '', 'utf8'));
      if (copyPath && this.workspace.indexByPath(copyPath)) await this.workspace.removeFile(copyPath);
    }
  }

  private async finishVerified(head: string, remoteAdvanced: boolean) {
    const previous = this.workspace.indexRows();
    const idByPath = new Map(previous.map((row) => [row.path, row.id]));
    const previousHead = this.state().local_head;
    if (previousHead && head && previousHead !== head) {
      const renamed = await this.git.run(['diff', '--name-status', '-z', '-M', previousHead, head, '--'], { cwd: this.workspace.root }).catch(() => '');
      const tokens = renamed.split('\0');
      for (let index = 0; index < tokens.length; index += 1) {
        if (!/^R\d+$/.test(tokens[index])) continue;
        const fromPath = tokens[index + 1];
        const toPath = tokens[index + 2];
        const id = idByPath.get(fromPath);
        if (id && toPath) idByPath.set(toPath, id);
        index += 2;
      }
    }
    await this.workspace.rebuildIndex(idByPath);
    const current = this.state();
    const generation = current.generation + (remoteAdvanced && current.dirty_count === 0 ? 1 : 0);
    const state: SyncState = this.countConflicts() ? 'conflict' : 'verified';
    this.database.db.prepare("UPDATE repository_state SET local_head=?,remote_head=?,generation=?,verified_generation=?,dirty_count=0,state=?,phase='completed',last_error='',verified_at=?,updated_at=? WHERE id=1").run(head, head, generation, generation, state, now(), now());
  }

  private async restoreDirty(base: string, snapshot: string) {
    await this.git.run(['cherry-pick', '--abort'], { cwd: this.workspace.root }).catch(() => undefined);
    if (!snapshot) return;
    await this.git.run(['reset', '--hard', snapshot], { cwd: this.workspace.root });
    if (base) {
      await this.git.run(['reset', '--mixed', base], { cwd: this.workspace.root });
    } else {
      await this.git.run(['update-ref', '-d', 'HEAD'], { cwd: this.workspace.root }).catch(() => undefined);
      await this.git.run(['rm', '--cached', '-r', '--ignore-unmatch', '.'], { cwd: this.workspace.root }).catch(() => undefined);
    }
    const snapshotPaths = new Set((await this.git.run(['ls-tree', '-r', '--name-only', '-z', snapshot], { cwd: this.workspace.root })).split('\0').filter(Boolean));
    const status = await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: this.workspace.root });
    const cleanup = this.workspace.parseStatus(status)
      .filter((entry) => entry.code === '??')
      .flatMap((entry) => entry.paths)
      .filter((path) => this.workspace.stageable(path) && !snapshotPaths.has(path));
    if (cleanup.length) await this.git.run(['clean', '-f', '--', ...cleanup], { cwd: this.workspace.root });
  }

  private async recoverJobs() {
    const jobs = this.database.db.prepare("SELECT * FROM sync_jobs WHERE state='running' ORDER BY created_at").all() as Array<Record<string, string>>;
    if (!jobs.length || !this.workspace.exists()) return;
    for (const job of jobs) {
      const candidate = job.candidate_commit;
      let snapshot = job.snapshot_commit;
      const base = job.base_commit;
      try {
        const currentHead = await this.head();
        if (!snapshot && currentHead && currentHead !== base && (job.type === 'sync' || job.phase === 'starting')) {
          snapshot = currentHead;
        }
        const remote = this.repository.branch() && this.github.hasToken() ? await this.lsRemote(this.repository.branch(), this.github.accessToken()) : '';
        if (candidate && remote) {
          await this.git.run(['fetch', '--no-tags', 'origin', `refs/heads/${this.repository.branch()}:refs/remotes/origin/${this.repository.branch()}`], { cwd: this.workspace.root, token: this.github.accessToken() });
          const contained = remote === candidate || await this.git.run(['merge-base', '--is-ancestor', candidate, remote], { cwd: this.workspace.root }).then(() => true).catch(() => false);
          if (contained) {
            await this.git.run(['reset', '--hard', remote], { cwd: this.workspace.root });
            await this.finishVerified(remote, true);
            this.completeJob(job.id);
            continue;
          }
        }
        if (snapshot) {
          await this.restoreDirty(base, snapshot);
          await this.discardJobConflicts(job.id);
          this.failJob(job.id, new Error('服务重启后已恢复同步前的本地修改'));
        } else if (job.type === 'management') {
          await this.restoreManagementBase(base);
          await this.discardJobConflicts(job.id);
          this.failJob(job.id, new Error('服务重启后已撤销未完成的文件结构调整'));
        } else {
          await this.discardJobConflicts(job.id);
          this.failJob(job.id, new Error('服务重启后已清理未完成同步任务'));
        }
      } catch (reason) {
        this.failJob(job.id, reason);
      }
    }
  }

  private async restoreManagementBase(base: string) {
    if (base) {
      await this.restoreDirty(base, base);
      return;
    }
    await this.git.run(['cherry-pick', '--abort'], { cwd: this.workspace.root }).catch(() => undefined);
    await this.git.run(['rm', '--cached', '-r', '--ignore-unmatch', '.'], { cwd: this.workspace.root }).catch(() => undefined);
    const status = await this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: this.workspace.root });
    const cleanup = this.workspace.parseStatus(status).flatMap((entry) => entry.paths).filter((path) => this.workspace.stageable(path));
    if (cleanup.length) await this.git.run(['clean', '-f', '--', ...cleanup], { cwd: this.workspace.root });
  }

  private async assertRepositorySafety() {
    if (!this.workspace.exists()) throw new ConflictException({ code: 'WORKSPACE_NOT_READY', message: 'Git 工作区尚未初始化' });
    const meta = await this.github.repository(this.repository.get());
    const branch = this.repository.branch();
    if (branch && meta.default_branch !== branch) {
      throw new ConflictException({ code: 'DEFAULT_BRANCH_CHANGED', message: 'GitHub 默认分支已变化，请断开后重新选择仓库' });
    }
    const remoteUrl = (await this.git.run(['remote', 'get-url', 'origin'], { cwd: this.workspace.root })).trim();
    if (remoteUrl !== this.github.cloneUrl(this.repository.get()) || /https:\/\/[^/\s]+@/i.test(remoteUrl)) {
      throw new BadRequestException({ code: 'REMOTE_URL_INVALID', message: 'Git remote 与当前仓库不一致，需要重新选择仓库' });
    }
  }

  private async discardIncompleteRepository() {
    this.repository.clear();
    await this.workspace.clear();
    await fs.rm(join(this.workspace.jobsRoot, 'conflicts'), { recursive: true, force: true });
    this.database.db.transaction(() => {
      this.database.db.prepare('DELETE FROM conflicts').run();
      this.database.db.prepare('DELETE FROM sync_jobs').run();
    })();
  }

  private async assertSafeStagePaths(paths: string[]) {
    await this.workspace.assertRegularStagePaths(paths);
    if (!paths.length) return;
    const indexed = await this.git.run(['ls-files', '-s', '-z', '--', ...paths], { cwd: this.workspace.root });
    const unsafe = indexed.split('\0').filter(Boolean).find((entry) => entry.startsWith('120000 ') || entry.startsWith('160000 '));
    if (unsafe) throw new BadRequestException({ code: 'UNSUPPORTED_GIT_ENTRY', message: '不支持修改符号链接或子模块' });
  }

  private async configureIdentity() {
    const login = this.github.login() || 'noteai';
    const account = this.github.accountId() || '0';
    await this.git.run(['config', '--local', 'user.name', login], { cwd: this.workspace.root });
    await this.git.run(['config', '--local', 'user.email', `${account}+${login}@users.noreply.github.com`], { cwd: this.workspace.root });
    await this.git.run(['config', '--local', 'commit.gpgsign', 'false'], { cwd: this.workspace.root });
  }

  private async head() {
    try {
      return (await this.git.run(['rev-parse', '--verify', 'HEAD'], { cwd: this.workspace.root })).trim();
    } catch {
      return '';
    }
  }

  private async hasStagedChanges() {
    const value = await this.git.run(['diff', '--cached', '--name-only', '-z'], { cwd: this.workspace.root });
    return Boolean(value);
  }

  private async commit(message: string) {
    await this.git.run(['commit', '--no-gpg-sign', '-m', message], { cwd: this.workspace.root });
  }

  private async lsRemote(branch: string, token: string) {
    const output = await this.git.run(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { cwd: this.workspace.root, token });
    return output.trim().split(/\s+/)[0] ?? '';
  }

  private async lsRemoteUrl(url: string, branch: string, token: string) {
    const output = await this.git.run(['ls-remote', '--heads', url, `refs/heads/${branch}`], { cwd: this.workspace.jobsRoot, token });
    return output.trim().split(/\s+/)[0] ?? '';
  }

  private async keepJobRef(jobId: string, commit: string) {
    await this.git.run(['update-ref', `refs/noteai/jobs/${jobId}/snapshot`, commit], { cwd: this.workspace.root });
  }

  private createJob(type: JobType, operations: TreeOperation[]) {
    const id = randomUUID();
    const base = this.state().local_head;
    this.database.db.prepare("INSERT INTO sync_jobs(id,type,state,phase,base_commit,operations,created_at,updated_at) VALUES(?,?, 'running','starting',?,?,?,?)").run(id, type, base, JSON.stringify(operations), now(), now());
    return id;
  }

  private updateJob(id: string, values: { snapshot_commit?: string; candidate_commit?: string; phase?: string }) {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    this.database.db.prepare(`UPDATE sync_jobs SET ${entries.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE id=?`).run(...entries.map(([, value]) => value), now(), id);
  }

  private completeJob(id: string) {
    this.database.db.prepare("UPDATE sync_jobs SET state='completed',phase='completed',error='',updated_at=? WHERE id=?").run(now(), id);
    void this.git.run(['update-ref', '-d', `refs/noteai/jobs/${id}/snapshot`], { cwd: this.workspace.root }).catch(() => undefined);
  }

  private failJob(id: string, reason: unknown) {
    this.database.db.prepare("UPDATE sync_jobs SET state='failed',phase='failed',error=?,updated_at=? WHERE id=?").run(this.message(reason), now(), id);
  }

  private async discardJobConflicts(jobId: string) {
    const rows = this.database.db.prepare('SELECT id FROM conflicts WHERE job_id=?').all(jobId) as Array<{ id: string }>;
    this.database.db.prepare('DELETE FROM conflicts WHERE job_id=?').run(jobId);
    await Promise.all(rows.map((row) => fs.rm(join(this.workspace.jobsRoot, 'conflicts', row.id), { recursive: true, force: true })));
  }

  private fail(reason: unknown) {
    const status = reason instanceof HttpException ? reason.getStatus() : 500;
    const state: SyncState = status === 401 ? 'unauthorized' : status === 409 && this.countConflicts() ? 'conflict' : 'failed';
    this.setState({ state, phase: 'failed', last_error: this.message(reason) });
  }

  private message(reason: unknown) {
    if (reason instanceof HttpException) {
      const response = reason.getResponse();
      if (typeof response === 'string') return response;
      const message = (response as { message?: string | string[] }).message;
      return Array.isArray(message) ? message.join('；') : message ?? reason.message;
    }
    return reason instanceof Error ? reason.message : '未知同步错误';
  }

  private errorCode(reason: unknown) {
    if (!(reason instanceof HttpException)) return '';
    const response = reason.getResponse();
    return typeof response === 'object' && response && 'code' in response ? String(response.code ?? '') : '';
  }

  private state() {
    return this.database.db.prepare('SELECT * FROM repository_state WHERE id=1').get() as RepositoryStateRow;
  }

  private setState(values: Partial<Pick<RepositoryStateRow, 'state' | 'phase' | 'last_error' | 'local_head' | 'remote_head'>>) {
    const entries = Object.entries(values);
    if (!entries.length) return;
    this.database.db.prepare(`UPDATE repository_state SET ${entries.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE id=1`).run(...entries.map(([, value]) => value), now());
  }

  private countConflicts() {
    return (this.database.db.prepare('SELECT count(*) count FROM conflicts').get() as { count: number }).count;
  }

  private countDecisions() {
    return (this.database.db.prepare('SELECT count(*) count FROM conflicts WHERE resolution_action IS NOT NULL').get() as { count: number }).count;
  }

  private artifactRelative(path: string) {
    return path.slice(this.workspace.jobsRoot.length + 1);
  }

  private async readArtifact(path: string | null) {
    if (!path) return null;
    return fs.readFile(join(this.workspace.jobsRoot, path), 'utf8').catch(() => null);
  }

  private artifactSize(id: string, stage: 'local' | 'remote') {
    const row = this.database.db.prepare(`SELECT ${stage}_file file FROM conflicts WHERE id=?`).get(id) as { file?: string } | undefined;
    if (!row?.file) return 0;
    try {
      return statSync(join(this.workspace.jobsRoot, row.file)).size;
    } catch {
      return 0;
    }
  }

  private async conflictCopyPath(path: string, id: string) {
    const extension = extname(path);
    const stem = basename(path, extension);
    const folder = dirname(path);
    const prefix = folder === '.' ? '' : `${folder}/`;
    let candidate = `${prefix}${stem}（冲突-${id.slice(0, 8)}）${extension}`;
    let index = 2;
    while (this.workspace.indexByPath(candidate) || existsSync(this.workspace.file(candidate))) {
      candidate = `${prefix}${stem}（冲突-${id.slice(0, 8)}-${index++}）${extension}`;
    }
    return candidate;
  }
}
