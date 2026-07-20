import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/modules/database/database.service.js';
import type { GitHubService } from '../src/modules/github/github.service.js';
import { NoteService } from '../src/modules/notes/note.service.js';
import { RepositoryService } from '../src/modules/settings/repository.service.js';
import { GitProcessService } from '../src/modules/storage/git-process.service.js';
import { PathPolicy } from '../src/modules/storage/path-policy.service.js';
import { RepositoryWorkspaceService } from '../src/modules/storage/repository-workspace.service.js';
import { SyncService } from '../src/modules/sync/sync.service.js';

const execute = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, ...args: string[]) {
  return (await execute('git', args, { cwd })).stdout.trim();
}

async function fixture(options: { empty?: boolean; repositoryError?: Error } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'noteai-git-test-'));
  roots.push(root);
  const remote = join(root, 'remote.git');
  const data = join(root, 'data');
  await mkdir(remote, { recursive: true });
  await git(remote, 'init', '--bare', '--initial-branch=main');
  if (!options.empty) {
    const seed = join(root, 'seed');
    await git(root, 'clone', remote, seed);
    await git(seed, 'config', 'user.name', 'fixture');
    await git(seed, 'config', 'user.email', 'fixture@example.com');
    await mkdir(join(seed, '归档'), { recursive: true });
    await writeFile(join(seed, '文章.md'), '# 文章\n\n初始内容');
    await writeFile(join(seed, '图片.png'), Buffer.from([0, 1, 2, 3, 255, 128]));
    await writeFile(join(seed, '归档', '.gitkeep'), '');
    await git(seed, 'add', '.');
    await git(seed, 'commit', '-m', 'seed');
    await git(seed, 'push', 'origin', 'main');
  }

  process.env.NOTEAI_DATA_ROOT = data;
  const database = new DatabaseService();
  const paths = new PathPolicy();
  const processGit = new GitProcessService();
  await processGit.onModuleInit();
  const workspace = new RepositoryWorkspaceService(database, paths);
  const repository = new RepositoryService(database);
  const github = {
    hasToken: () => true,
    accessToken: () => 'integration-test-token',
    login: () => 'noteai-test',
    accountId: () => '100',
    repository: async () => {
      if (options.repositoryError) throw options.repositoryError;
      return { full_name: 'owner/notes', default_branch: 'main', permissions: { push: true } };
    },
    cloneUrl: () => remote,
  } as unknown as GitHubService;
  const sync = new SyncService(database, paths, repository, github, processGit, workspace);
  const notes = new NoteService(database, paths, workspace, sync);
  await sync.selectRepository('owner/notes');
  await waitFor(sync, (status) => status.state === 'verified' || status.phase === 'failed');
  if (!options.repositoryError) expect(sync.status().lastError).toBe('');
  return { root, remote, data, database, paths, processGit, workspace, repository, github, sync, notes };
}

async function waitFor(sync: SyncService, predicate: (status: ReturnType<SyncService['status']>) => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = sync.status();
    if (predicate(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待同步状态超时：${JSON.stringify(sync.status())}`);
}

afterEach(async () => {
  delete process.env.NOTEAI_DATA_ROOT;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

describe('真实 Git working tree', () => {
  it('首次克隆初始化失败时暴露错误并清除仓库绑定，不保留 cloning 假状态', async () => {
    const { database, repository, sync, workspace } = await fixture({ repositoryError: new Error('GitHub 仓库元数据请求失败') });

    expect(sync.status()).toMatchObject({
      state: 'unconfigured',
      phase: 'failed',
      lastError: 'GitHub 仓库元数据请求失败',
      manualSyncAvailable: false,
    });
    expect(repository.get()).toBe('');
    expect(workspace.exists()).toBe(false);
    database.db.close();
  });

  it('重置会清空本地工作区和仓库绑定，等待重新选择', async () => {
    const { database, repository, sync, workspace } = await fixture();
    await writeFile(join(workspace.root, '中断的本地文件.md'), '# 临时内容');

    const status = await sync.reset();

    expect(status.state).toBe('unconfigured');
    expect(repository.get()).toBe('');
    expect(workspace.exists()).toBe(false);
    await expect(readFile(join(workspace.root, '中断的本地文件.md'))).rejects.toThrow();
    database.db.close();
  });

  it('半成品 .git 不会自动重新初始化，而是清空绑定等待重新选择', async () => {
    const { database, repository, sync, workspace } = await fixture();
    database.db.prepare("UPDATE repository_state SET branch='' WHERE id=1").run();
    const initialize = vi.spyOn(sync as unknown as { initialize: () => Promise<void> }, 'initialize').mockResolvedValue();

    expect(sync.triggerSync().state).toBe('unconfigured');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(initialize).not.toHaveBeenCalled();
    expect(repository.get()).toBe('');
    expect(workspace.exists()).toBe(false);
    database.db.close();
  });

  it('clone 后从工作区读取，并把标题改名与内容作为标准 Git commit push', async () => {
    const { remote, database, sync, notes } = await fixture();
    const opened = await notes.content('文章.md');
    expect(opened.content).toContain('初始内容');

    const saved = await notes.save(opened.path, '# 新标题\n\n修改后的正文', opened.revision, opened.id);
    expect(saved.path).toBe('新标题.md');
    sync.triggerSync();
    await waitFor(sync, (status) => status.state === 'verified' && status.dirtyCount === 0);

    expect(await git(remote, 'show', 'main:新标题.md')).toContain('修改后的正文');
    await expect(git(remote, 'show', 'main:文章.md')).rejects.toThrow();
    const row = database.db.prepare('SELECT path,revision FROM file_index WHERE id=?').get(opened.id) as { path: string; revision: string };
    expect(row.path).toBe('新标题.md');
    expect(row.revision).toBe(saved.revision);
    database.db.close();
  });

  it('批量移动二进制文件只新增一个远端 commit，Git blob 和字节保持不变', async () => {
    const { remote, database, notes } = await fixture();
    const beforeCommit = await git(remote, 'rev-parse', 'main');
    const beforeBlob = await git(remote, 'rev-parse', 'main:图片.png');
    const beforeBytes = await execute('git', ['--git-dir', remote, 'show', 'main:图片.png'], { encoding: 'buffer' });
    const tree = await notes.managementTree();
    const image = tree.files.find((file) => file.path === '图片.png')!;

    const result = await notes.applyTreeChanges(tree.treeVersion, [{ type: 'move-file', id: image.id, fromPath: image.path, toFolder: '归档', revision: image.revision }]);
    expect(result.files.some((file) => file.path === '归档/图片.png')).toBe(true);
    const afterCommit = await git(remote, 'rev-parse', 'main');
    const afterBlob = await git(remote, 'rev-parse', 'main:归档/图片.png');
    const afterBytes = await execute('git', ['--git-dir', remote, 'show', 'main:归档/图片.png'], { encoding: 'buffer' });
    expect(afterCommit).not.toBe(beforeCommit);
    expect(await git(remote, 'rev-list', '--count', `${beforeCommit}..${afterCommit}`)).toBe('1');
    expect(afterBlob).toBe(beforeBlob);
    expect(afterBytes.stdout).toEqual(beforeBytes.stdout);
    database.db.close();
  });

  it('递归删除非空目录只产生一个远端 commit，并同步移除文件和 .gitkeep', async () => {
    const { remote, database, sync, notes } = await fixture();
    await notes.save('归档/未命名.md', '# 待删除\n\n正文');
    sync.triggerSync();
    await waitFor(sync, (status) => status.state === 'verified' && status.dirtyCount === 0);
    const before = await git(remote, 'rev-parse', 'main');
    const tree = await notes.managementTree();

    await notes.applyTreeChanges(tree.treeVersion, [{ type: 'delete-folder', path: '归档', recursive: true }]);
    const after = await git(remote, 'rev-parse', 'main');
    expect(await git(remote, 'rev-list', '--count', `${before}..${after}`)).toBe('1');
    const paths = await git(remote, 'ls-tree', '-r', '--name-only', 'main');
    expect(paths).not.toContain('归档/');
    database.db.close();
  });

  it('管理确认前远端已前进时返回 REMOTE_CHANGED，刷新本地基线且不残留结构修改', async () => {
    const { root, remote, database, workspace, notes } = await fixture();
    const tree = await notes.managementTree();
    const article = tree.files.find((file) => file.path === '文章.md')!;
    const external = join(root, 'external');
    await git(root, 'clone', remote, external);
    await git(external, 'config', 'user.name', 'external');
    await git(external, 'config', 'user.email', 'external@example.com');
    await writeFile(join(external, '远端.md'), '# 远端');
    await git(external, 'add', '.');
    await git(external, 'commit', '-m', 'remote ahead');
    await git(external, 'push', 'origin', 'main');

    await expect(notes.applyTreeChanges(tree.treeVersion, [{ type: 'move-file', id: article.id, fromPath: article.path, toFolder: '归档', revision: article.revision }])).rejects.toMatchObject({ response: { code: 'REMOTE_CHANGED' } });
    expect(await readFile(workspace.file('文章.md'), 'utf8')).toContain('初始内容');
    await expect(readFile(workspace.file('归档/文章.md'))).rejects.toThrow();
    expect((await notes.tree()).files.some((file) => file.path === '远端.md')).toBe(true);
    database.db.close();
  });

  it('批量结构调整中途失败时回滚已经执行的前序操作', async () => {
    const { database, workspace, notes } = await fixture();
    const tree = await notes.managementTree();
    const article = tree.files.find((file) => file.path === '文章.md')!;
    vi.spyOn(workspace, 'assertManagedFolder').mockRejectedValueOnce(new Error('模拟后序目录操作失败'));

    await expect(notes.applyTreeChanges(tree.treeVersion, [
      { type: 'move-file', id: article.id, fromPath: article.path, toFolder: '归档', revision: article.revision },
      { type: 'delete-folder', path: '归档', recursive: true },
    ])).rejects.toThrow('模拟后序目录操作失败');

    expect(await readFile(workspace.file('文章.md'), 'utf8')).toContain('初始内容');
    await expect(readFile(workspace.file('归档/文章.md'))).rejects.toThrow();
    expect(await git(workspace.root, 'status', '--porcelain')).toBe('');
    database.db.close();
  });

  it('显式空目录使用隐藏 .gitkeep，并在同步后仍不出现在文件列表', async () => {
    const { remote, database, sync, notes } = await fixture({ empty: true });
    await notes.createFolder('空目录');
    sync.triggerSync();
    await waitFor(sync, (status) => status.state === 'verified' && status.dirtyCount === 0);
    expect(await git(remote, 'show', 'main:空目录/.gitkeep')).toBe('');
    const tree = await notes.tree();
    expect(tree.folders).toContain('空目录');
    expect(tree.files).toEqual([]);
    database.db.close();
  });

  it('不支持文件发生本地修改时拒绝 stage 和同步', async () => {
    const { database, workspace, sync } = await fixture();
    await writeFile(join(workspace.root, 'script.ts'), 'export {};');
    await sync.markDirty();
    sync.triggerSync();
    const status = await waitFor(sync, (value) => value.state === 'failed');
    expect(status.lastError).toContain('不支持的本地改动');
    expect(await git(workspace.root, 'status', '--porcelain')).toContain('script.ts');
    database.db.close();
  });

  it('文件写入占用 working tree 时结构提交快速返回 423', async () => {
    const { database, sync } = await fixture();
    let release!: () => void;
    const writing = sync.write(() => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();

    await expect(sync.commitManagementTree({ operations: [], idByPath: new Map(), baseGeneration: 0, expectedFiles: [] }))
      .rejects.toMatchObject({ status: 423 });
    let syncError: unknown;
    try { sync.triggerSync(); } catch (reason) { syncError = reason; }
    expect(syncError).toMatchObject({ status: 423 });

    release();
    await writing;
    database.db.close();
  });

  it('远端与本地修改不同文件时用 cherry-pick 自动合并并 fast-forward push', async () => {
    const { root, remote, database, sync, notes } = await fixture();
    const article = await notes.content('文章.md');
    await notes.save(article.path, '# 文章\n\n本地修改', article.revision, article.id);

    const external = join(root, 'external-non-conflict');
    await git(root, 'clone', remote, external);
    await git(external, 'config', 'user.name', 'external');
    await git(external, 'config', 'user.email', 'external@example.com');
    await writeFile(join(external, '远端.md'), '# 远端新增');
    await git(external, 'add', '.');
    await git(external, 'commit', '-m', 'remote file');
    await git(external, 'push', 'origin', 'main');

    sync.triggerSync();
    const status = await waitFor(sync, (value) => value.state === 'verified' || value.state === 'failed');
    expect(status.state).toBe('verified');
    expect(await git(remote, 'show', 'main:文章.md')).toContain('本地修改');
    expect(await git(remote, 'show', 'main:远端.md')).toContain('远端新增');
    database.db.close();
  });

  it('push 瞬间发生远端竞争时恢复 dirty 内容并自动重试一次', async () => {
    const { root, remote, database, processGit, sync, notes } = await fixture();
    const article = await notes.content('文章.md');
    await notes.save(article.path, '# 文章\n\n本地竞争版本', article.revision, article.id);

    const external = join(root, 'external-push-race');
    await git(root, 'clone', remote, external);
    await git(external, 'config', 'user.name', 'external');
    await git(external, 'config', 'user.email', 'external@example.com');
    await writeFile(join(external, '竞争远端.md'), '# 远端竞争版本');
    await git(external, 'add', '.');
    await git(external, 'commit', '-m', 'remote push race');

    const run = processGit.run.bind(processGit);
    let injected = false;
    vi.spyOn(processGit, 'run').mockImplementation(async (args, options) => {
      if (!injected && args[0] === 'push') {
        injected = true;
        await git(external, 'push', 'origin', 'main');
      }
      return run(args, options);
    });

    sync.triggerSync();
    const status = await waitFor(sync, (value) => value.state === 'verified' || value.state === 'failed');
    expect(status.state).toBe('verified');
    expect(injected).toBe(true);
    expect(await git(remote, 'show', 'main:文章.md')).toContain('本地竞争版本');
    expect(await git(remote, 'show', 'main:竞争远端.md')).toContain('远端竞争版本');
    database.db.close();
  });

  it('受保护分支拒绝 push 时保留原始 422 语义和本地 dirty 内容', async () => {
    const { remote, database, workspace, sync, notes } = await fixture();
    await writeFile(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nprintf "%s\\n" "protected branch" >&2\nexit 1\n', { mode: 0o755 });
    const article = await notes.content('文章.md');
    await notes.save(article.path, '# 文章\n\n未推送内容', article.revision, article.id);

    sync.triggerSync();
    const status = await waitFor(sync, (value) => value.state === 'failed');
    expect(status.lastError).toContain('GitHub 拒绝了提交');
    expect(await readFile(workspace.file('文章.md'), 'utf8')).toContain('未推送内容');
    expect(await git(workspace.root, 'status', '--porcelain')).not.toBe('');
    expect(await git(remote, 'show', 'main:文章.md')).toContain('初始内容');
    database.db.close();
  });

  it('Git 子进程超过硬超时后终止并返回 504', async () => {
    const { database, processGit, workspace } = await fixture();
    await writeFile(join(workspace.root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nsleep 2\n', { mode: 0o755 });
    await expect(processGit.run(['commit', '--allow-empty', '-m', 'timeout test'], { cwd: workspace.root, timeout: 50 }))
      .rejects.toMatchObject({ status: 504 });
    database.db.close();
  });

  it('未分类 Git 子进程错误返回明确的 502 而不是 500', async () => {
    const { database, processGit, workspace } = await fixture();
    await expect(processGit.run(['noteai-command-does-not-exist'], { cwd: workspace.root }))
      .rejects.toMatchObject({ status: 502 });
    database.db.close();
  });

  it('外部 Git rename 通过 diff -M 保持稳定文件 ID', async () => {
    const { root, remote, database, sync, notes } = await fixture();
    const before = await notes.tree();
    const article = before.files.find((file) => file.path === '文章.md')!;
    const external = join(root, 'external-rename');
    await git(root, 'clone', remote, external);
    await git(external, 'config', 'user.name', 'external');
    await git(external, 'config', 'user.email', 'external@example.com');
    await git(external, 'mv', '文章.md', '外部改名.md');
    await git(external, 'commit', '-m', 'rename');
    await git(external, 'push', 'origin', 'main');

    sync.triggerSync();
    await waitFor(sync, (value) => value.state === 'verified' || value.state === 'failed');
    const after = await notes.tree();
    expect(after.files.find((file) => file.path === '外部改名.md')?.id).toBe(article.id);
    database.db.close();
  });

  it('同路径并发修改使用 Git index 三方内容，远端留在主路径且本地生成冲突副本', async () => {
    const { root, remote, database, sync, notes } = await fixture();
    const article = await notes.content('文章.md');
    await notes.save(article.path, '# 文章\n\n本地版本', article.revision, article.id);

    const external = join(root, 'external-conflict');
    await git(root, 'clone', remote, external);
    await git(external, 'config', 'user.name', 'external');
    await git(external, 'config', 'user.email', 'external@example.com');
    await writeFile(join(external, '文章.md'), '# 文章\n\n远端版本');
    await git(external, 'add', '.');
    await git(external, 'commit', '-m', 'remote same path');
    await git(external, 'push', 'origin', 'main');

    sync.triggerSync();
    const status = await waitFor(sync, (value) => value.state === 'conflict' || value.state === 'failed');
    expect(status.state).toBe('conflict');
    expect(await git(remote, 'show', 'main:文章.md')).toContain('远端版本');
    const tree = await notes.tree();
    const page = sync.conflicts({});
    const detail = await sync.conflictDetail((page.items[0] as unknown as { id: string }).id);
    const copy = tree.files.find((file) => file.path.startsWith('文章（冲突-'));
    expect(copy).toBeTruthy();
    expect((await notes.content(copy!.path)).content).toContain('本地版本');
    expect(page.total).toBe(1);
    expect(detail?.base_content).toContain('初始内容');
    expect(detail?.local_content).toContain('本地版本');
    expect(detail?.remote_content).toContain('远端版本');
    database.db.close();
  });

  it('token 不进入 remote URL、Git config 和持久任务错误', async () => {
    const { database, workspace } = await fixture();
    const remoteUrl = await git(workspace.root, 'remote', 'get-url', 'origin');
    const config = await git(workspace.root, 'config', '--local', '--list');
    const jobs = database.db.prepare('SELECT error FROM sync_jobs').all() as Array<{ error: string }>;
    expect(remoteUrl).not.toContain('integration-test-token');
    expect(config).not.toContain('integration-test-token');
    expect(JSON.stringify(jobs)).not.toContain('integration-test-token');
    database.db.close();
  });

  it('符号链接和 Git LFS pointer 不进入索引且禁止 stage', async () => {
    const { database, workspace, sync } = await fixture();
    await symlink('文章.md', join(workspace.root, '链接.md'));
    await writeFile(join(workspace.root, '大图.png'), 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 100\n');
    await sync.markDirty();
    sync.triggerSync();
    const status = await waitFor(sync, (value) => value.state === 'failed');
    expect(status.lastError).toMatch(/符号链接|Git LFS/);
    expect(await git(workspace.root, 'ls-files', '链接.md', '大图.png')).toBe('');
    await workspace.rebuildIndex();
    expect(workspace.indexByPath('链接.md')).toBeUndefined();
    expect(workspace.indexByPath('大图.png')).toBeUndefined();
    database.db.close();
  });

  it('进程在 snapshot 后崩溃时恢复原有未提交内容和 base HEAD', async () => {
    const { database, workspace, sync, notes } = await fixture();
    const article = await notes.content('文章.md');
    await notes.save(article.path, '# 文章\n\n崩溃前未提交内容', article.revision, article.id);
    const base = await git(workspace.root, 'rev-parse', 'HEAD');
    await git(workspace.root, 'add', '--all', '--', '文章.md');
    await git(workspace.root, 'commit', '-m', 'snapshot before crash');
    const snapshot = await git(workspace.root, 'rev-parse', 'HEAD');
    const jobId = 'crash-after-snapshot';
    const timestamp = new Date().toISOString();
    database.db.prepare("INSERT INTO sync_jobs(id,type,state,phase,base_commit,snapshot_commit,operations,created_at,updated_at) VALUES(?,?,'running','snapshot',?,?,?, ?,?)").run(jobId, 'sync', base, snapshot, '[]', timestamp, timestamp);

    await (sync as unknown as { recoverJobs: () => Promise<void> }).recoverJobs();
    expect(await git(workspace.root, 'rev-parse', 'HEAD')).toBe(base);
    expect(await readFile(workspace.file('文章.md'), 'utf8')).toContain('崩溃前未提交内容');
    expect(await git(workspace.root, 'status', '--porcelain')).not.toBe('');
    expect((database.db.prepare('SELECT state FROM sync_jobs WHERE id=?').get(jobId) as { state: string }).state).toBe('failed');
    database.db.close();
  });

  it('snapshot commit 已创建但任务 SHA 尚未落库时仍能从当前 HEAD 恢复', async () => {
    const { database, workspace, sync, notes } = await fixture();
    const article = await notes.content('文章.md');
    await notes.save(article.path, '# 文章\n\n尚未记录 snapshot SHA', article.revision, article.id);
    const base = await git(workspace.root, 'rev-parse', 'HEAD');
    await git(workspace.root, 'add', '--all', '--', '文章.md');
    await git(workspace.root, 'commit', '-m', 'snapshot before database update');
    const timestamp = new Date().toISOString();
    database.db.prepare("INSERT INTO sync_jobs(id,type,state,phase,base_commit,operations,created_at,updated_at) VALUES(?,'sync','running','starting',?,'[]',?,?)")
      .run('crash-before-snapshot-persist', base, timestamp, timestamp);

    await (sync as unknown as { recoverJobs: () => Promise<void> }).recoverJobs();
    expect(await git(workspace.root, 'rev-parse', 'HEAD')).toBe(base);
    expect(await readFile(workspace.file('文章.md'), 'utf8')).toContain('尚未记录 snapshot SHA');
    expect(await git(workspace.root, 'status', '--porcelain')).not.toBe('');
    database.db.close();
  });
});

describe('全新数据库切换', () => {
  it('检测到旧 notes.sqlite 时拒绝启动，不执行迁移', async () => {
    const root = await mkdtemp(join(tmpdir(), 'noteai-legacy-test-'));
    roots.push(root);
    await mkdir(join(root, 'meta'), { recursive: true });
    await writeFile(join(root, 'meta', 'notes.sqlite'), 'legacy');
    process.env.NOTEAI_DATA_ROOT = root;
    expect(() => new DatabaseService()).toThrow('不迁移旧数据');
  });
});
