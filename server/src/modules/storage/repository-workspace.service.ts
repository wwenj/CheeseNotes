import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { hash } from '../../common/crypto.js';
import { isText } from '../../common/file-types.js';
import { noteTitle } from '../../common/note-title.js';
import { runtimeConfig } from '../../config/runtime.config.js';
import { DatabaseService } from '../database/database.service.js';
import { PathPolicy } from './path-policy.service.js';

export type FileIndexRow = {
  id: string;
  path: string;
  revision: string;
  title: string;
  kind: string;
  updated_at: string;
};

export type WorkspaceScan = { files: FileIndexRow[]; folders: string[] };

@Injectable()
export class RepositoryWorkspaceService {
  readonly root = join(runtimeConfig().dataRoot, 'repository');
  readonly jobsRoot = join(runtimeConfig().dataRoot, 'git-jobs');

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PathPolicy) private readonly paths: PathPolicy,
  ) {}

  exists() {
    return existsSync(join(this.root, '.git'));
  }

  async prepareRoots() {
    await fs.mkdir(this.jobsRoot, { recursive: true });
  }

  async clear() {
    await fs.rm(this.root, { recursive: true, force: true });
    await fs.mkdir(this.jobsRoot, { recursive: true });
    this.database.db.prepare('DELETE FROM file_index').run();
  }

  file(path: string) {
    return this.absolute(this.paths.safe(path));
  }

  folder(path: string) {
    return this.absolute(this.paths.safeFolder(path));
  }

  async read(path: string) {
    const target = this.file(path);
    await this.assertRegularFile(target);
    return fs.readFile(target);
  }

  async readText(path: string) {
    return (await this.read(path)).toString('utf8');
  }

  async pathExists(path: string) {
    const target = this.absolute(path);
    return fs.lstat(target).then(() => true).catch(() => false);
  }

  async writeAtomic(path: string, content: string | Buffer) {
    const safe = this.paths.safe(path, typeof content === 'string');
    const target = this.absolute(safe);
    await this.assertSafeAncestors(dirname(target));
    await fs.mkdir(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.${basename(target)}.noteai-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, content, { flag: 'wx' });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async moveFile(fromPath: string, toPath: string) {
    const source = this.file(fromPath);
    const target = this.file(toPath);
    await this.assertRegularFile(source);
    await this.assertMissing(target);
    await this.assertSafeAncestors(dirname(target));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.rename(source, target);
  }

  async moveFolder(fromPath: string, toPath: string) {
    const source = this.folder(fromPath);
    const target = this.folder(toPath);
    await this.assertDirectory(source);
    await this.assertMissing(target);
    await this.assertSafeAncestors(dirname(target));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.rename(source, target);
  }

  async removeFile(path: string) {
    const target = this.file(path);
    await this.assertRegularFile(target);
    await fs.rm(target);
    await this.prune(dirname(target));
  }

  async removeFolder(path: string) {
    const target = this.folder(path);
    await this.assertDirectory(target);
    await fs.rm(target, { recursive: true });
    await this.prune(dirname(target));
  }

  async createFolder(path: string) {
    const target = this.folder(path);
    await this.assertMissing(target);
    await this.assertSafeAncestors(dirname(target));
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(join(target, '.gitkeep'), '');
  }

  async assertManagedFolder(path: string) {
    const root = this.folder(path);
    await this.assertDirectory(root);
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new BadRequestException('文件夹包含符号链接，NoteAI 不允许移动或删除');
        if (entry.isDirectory()) {
          if (existsSync(join(directory, entry.name, '.git'))) throw new BadRequestException('文件夹包含子模块，NoteAI 不允许移动或删除');
          await visit(join(directory, entry.name), relativePath);
        } else if (!entry.isFile() || (entry.name !== '.gitkeep' && !this.paths.allowed(relativePath))) {
          throw new BadRequestException(`文件夹包含不受 NoteAI 管理的文件「${relativePath}」，已拒绝修改`);
        } else if (entry.name !== '.gitkeep' && await this.isLfsPointer(join(directory, entry.name))) {
          throw new BadRequestException(`文件夹包含 Git LFS 文件「${relativePath}」，NoteAI 不允许移动或删除`);
        }
      }
    };
    await visit(root, this.paths.safeFolder(path));
  }

  indexRows() {
    return this.database.db.prepare('SELECT * FROM file_index ORDER BY path').all() as FileIndexRow[];
  }

  indexById(id: string) {
    return this.database.db.prepare('SELECT * FROM file_index WHERE id=?').get(id) as FileIndexRow | undefined;
  }

  indexByPath(path: string) {
    return this.database.db.prepare('SELECT * FROM file_index WHERE path=?').get(path) as FileIndexRow | undefined;
  }

  async folders() {
    const folders = new Set<string>();
    for (const row of this.indexRows()) for (const folder of this.parents(row.path)) folders.add(folder);
    if (!this.exists()) return [];
    const walk = async (directory: string, prefix = ''): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      if (prefix && entries.some((entry) => entry.isFile() && entry.name === '.gitkeep')) {
        for (const folder of this.parents(prefix, true)) folders.add(folder);
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || (!prefix && entry.name === '.git')) continue;
        const target = join(directory, entry.name);
        if (existsSync(join(target, '.git'))) continue;
        await walk(target, prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    };
    await walk(this.root);
    return [...folders].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }

  async scan(idByPath: Map<string, string> = new Map()) : Promise<WorkspaceScan> {
    const previous = new Map(this.indexRows().map((row) => [row.path, row.id]));
    const files: FileIndexRow[] = [];
    const explicitFolders = new Set<string>();
    const visibleFolders = new Set<string>();
    if (!this.exists()) return { files, folders: [] };

    const walk = async (directory: string, prefix = ''): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!prefix && entry.name === '.git') continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        const target = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          if (existsSync(join(target, '.git'))) continue;
          await walk(target, path);
          continue;
        }
        if (!entry.isFile()) continue;
        if (entry.name === '.gitkeep') {
          if (prefix) explicitFolders.add(prefix);
          continue;
        }
        if (!this.paths.allowed(path)) continue;
        const data = await fs.readFile(target);
        if (this.lfsPointer(data)) continue;
        const stat = await fs.stat(target);
        const text = isText(path) ? data.toString('utf8') : '';
        for (const folder of this.parents(path)) visibleFolders.add(folder);
        files.push({
          id: idByPath.get(path) ?? previous.get(path) ?? randomUUID(),
          path,
          revision: hash(data),
          title: isText(path) ? noteTitle(path, text) : basename(path),
          kind: this.kind(path),
          updated_at: stat.mtime.toISOString(),
        });
      }
    };
    await walk(this.root);
    for (const folder of explicitFolders) for (const parent of this.parents(folder, true)) visibleFolders.add(parent);
    files.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
    return { files, folders: [...visibleFolders].sort((left, right) => left.localeCompare(right, 'zh-CN')) };
  }

  async rebuildIndex(idByPath: Map<string, string> = new Map()) {
    const scanned = await this.scan(idByPath);
    this.database.db.transaction(() => {
      this.database.db.prepare('DELETE FROM file_index').run();
      const insert = this.database.db.prepare('INSERT INTO file_index(id,path,revision,title,kind,updated_at) VALUES(?,?,?,?,?,?)');
      for (const file of scanned.files) insert.run(file.id, file.path, file.revision, file.title, file.kind, file.updated_at);
    })();
    return scanned;
  }

  async assertSupportedWorkingChanges(status: string) {
    const entries = this.parseStatus(status);
    const unsupported = entries.flatMap((entry) => entry.paths).filter((path) => !this.stageable(path));
    if (unsupported.length) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_LOCAL_CHANGES',
        message: `检测到 NoteAI 不支持的本地改动，已拒绝同步：${unsupported.slice(0, 5).join('、')}`,
      });
    }
    return entries;
  }

  async assertRegularStagePaths(paths: string[]) {
    for (const path of paths) {
      if (!this.stageable(path)) continue;
      const target = resolve(this.root, path);
      if (!target.startsWith(`${this.root}${sep}`)) throw new BadRequestException('非法仓库路径');
      const stat = await fs.lstat(target).catch(() => null);
      if (!stat) continue;
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new BadRequestException({ code: 'UNSUPPORTED_GIT_ENTRY', message: `不支持符号链接或特殊文件「${path}」` });
      }
      if (path !== '.gitkeep' && !path.endsWith('/.gitkeep') && await this.isLfsPointer(target)) {
        throw new BadRequestException({ code: 'UNSUPPORTED_GIT_ENTRY', message: `不支持 Git LFS 文件「${path}」` });
      }
    }
  }

  parseStatus(status: string) {
    const tokens = status.split('\0');
    const output: Array<{ code: string; paths: string[] }> = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token || token.length < 4) continue;
      const code = token.slice(0, 2);
      const paths = [token.slice(3)];
      if (/[RC]/.test(code) && tokens[index + 1]) paths.push(tokens[++index]);
      output.push({ code, paths });
    }
    return output;
  }

  stageable(path: string) {
    return path === '.gitkeep' || path.endsWith('/.gitkeep') || this.paths.allowed(path);
  }

  private absolute(path: string) {
    const target = resolve(this.root, path);
    if (target === this.root || !target.startsWith(`${this.root}${sep}`)) throw new BadRequestException('非法仓库路径');
    return target;
  }

  private async assertSafeAncestors(directory: string) {
    const relativePath = relative(this.root, directory);
    if (relativePath.startsWith('..') || relativePath === '') return;
    let current = this.root;
    for (const part of relativePath.split(sep)) {
      current = join(current, part);
      const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (stat?.isSymbolicLink()) throw new BadRequestException('仓库路径包含符号链接');
      if (stat && !stat.isDirectory()) throw new BadRequestException('仓库路径不是目录');
    }
  }

  private async assertRegularFile(target: string) {
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat) throw new NotFoundException('文件不存在');
    if (stat.isSymbolicLink() || !stat.isFile()) throw new BadRequestException('只允许访问普通文件');
  }

  private async assertDirectory(target: string) {
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat) throw new NotFoundException('文件夹不存在');
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BadRequestException('只允许访问普通目录');
  }

  private async assertMissing(target: string) {
    if (await fs.lstat(target).then(() => true).catch(() => false)) throw new ConflictException('目标位置已存在同名文件或目录');
  }

  private async prune(directory: string) {
    let current = directory;
    while (current.startsWith(`${this.root}${sep}`)) {
      const entries = await fs.readdir(current).catch(() => ['.missing']);
      if (entries.length) break;
      await fs.rmdir(current);
      current = dirname(current);
    }
  }

  private parents(path: string, includePath = false) {
    const parts = path.split('/');
    const length = includePath ? parts.length : parts.length - 1;
    return Array.from({ length }, (_, index) => parts.slice(0, index + 1).join('/'));
  }

  private kind(path: string) {
    if (isText(path)) return extname(path).toLowerCase() === '.md' ? 'markdown' : 'text';
    const extension = extname(path).toLowerCase();
    if (extension === '.pdf') return 'pdf';
    if (['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac'].includes(extension)) return 'audio';
    if (['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.3gp', '.3g2'].includes(extension)) return 'video';
    return 'image';
  }

  private async isLfsPointer(path: string) {
    const stat = await fs.stat(path).catch(() => null);
    if (!stat?.isFile() || stat.size > 1024) return false;
    return this.lfsPointer(await fs.readFile(path));
  }

  private lfsPointer(value: Buffer) {
    return value.subarray(0, 200).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1\n');
  }
}
