import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { hash } from '../../common/crypto.js';
import { isText, mimeTypes } from '../../common/file-types.js';
import { noteTitle } from '../../common/note-title.js';
import { now } from '../../common/time.js';
import { DatabaseService } from '../database/database.service.js';
import { PathPolicy } from '../storage/path-policy.service.js';
import { RepositoryWorkspaceService } from '../storage/repository-workspace.service.js';
import { SyncService, type TreeOperation } from '../sync/sync.service.js';

type TreeEntry = { id: string; path: string; revision: string; assetVersion: string; updated_at: string; title: string };
type NoteTree = { files: TreeEntry[]; folders: string[] };

const uploadImageExtensions = new Set(['.png', '.apng', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico', '.heic', '.heif']);

function imageKind(data: Buffer) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (data.length >= 2 && data.subarray(0, 2).toString('ascii') === 'BM') return 'bmp';
  if (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0) return 'ico';
  const brand = data.length >= 12 && data.subarray(4, 8).toString('ascii') === 'ftyp' ? data.subarray(8, 12).toString('ascii') : '';
  if (['avif', 'avis'].includes(brand)) return 'avif';
  if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heif';
  const text = data.subarray(0, Math.min(data.length, 4096)).toString('utf8').replace(/^\uFEFF?\s*/, '');
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) return 'svg';
  return null;
}

function extensionMatchesImageKind(extension: string, kind: string) {
  if (kind === 'png') return extension === '.png' || extension === '.apng';
  if (kind === 'jpeg') return ['.jpg', '.jpeg', '.jfif'].includes(extension);
  if (kind === 'heif') return extension === '.heic' || extension === '.heif';
  return extension === `.${kind}`;
}

function mimeMatchesImageKind(mime: string, kind: string) {
  const value = mime.toLowerCase().split(';')[0].trim();
  const allowed: Record<string, string[]> = {
    png: ['image/png', 'image/apng'], jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'], gif: ['image/gif'], webp: ['image/webp'], svg: ['image/svg+xml'], avif: ['image/avif'], bmp: ['image/bmp', 'image/x-ms-bmp'], ico: ['image/x-icon', 'image/vnd.microsoft.icon'], heif: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  };
  return allowed[kind]?.includes(value) ?? false;
}

function safeUploadName(filename: string) {
  const original = basename(filename).normalize('NFC');
  const extension = extname(original).toLowerCase();
  const stem = original.slice(0, original.length - extension.length)
    .replace(/[\\/:*?"<>|#%()`\u0000-\u001f\u007f]/g, '-')
    .replace(/[\[\]]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 100);
  return { extension, name: `${stem || 'image'}${extension}` };
}

function parentFolders(path: string, includePath = false) {
  const parts = path.split('/').filter(Boolean);
  const limit = includePath ? parts.length : parts.length - 1;
  return Array.from({ length: limit }, (_, index) => parts.slice(0, index + 1).join('/'));
}

function isWithin(path: string, folder: string) {
  return path === folder || path.startsWith(`${folder}/`);
}

@Injectable()
export class NoteService {
  private readonly md = new MarkdownIt({ html: false, linkify: true });

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PathPolicy) private readonly paths: PathPolicy,
    @Inject(RepositoryWorkspaceService) private readonly workspace: RepositoryWorkspaceService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  async content(path: string) {
    const safe = this.paths.safe(path);
    if (!isText(safe)) throw new BadRequestException('该文件不能作为文本笔记打开');
    const row = this.workspace.indexByPath(safe);
    if (!row) throw new NotFoundException('笔记不存在');
    return { id: row.id, path: row.path, content: await this.workspace.readText(safe), revision: row.revision };
  }

  async tree(): Promise<NoteTree> {
    return (await this.treeSnapshot()).tree;
  }

  async managementTree() {
    const snapshot = await this.treeSnapshot();
    return { ...snapshot.tree, treeVersion: snapshot.version };
  }

  async applyTreeChanges(baseTreeVersion: string, rawOperations: unknown[]) {
    const current = await this.treeSnapshot();
    if (baseTreeVersion !== current.version) throw new ConflictException({ code: 'TREE_VERSION_STALE', message: '文件结构已变化，请刷新后重新整理' });
    const operations = rawOperations.map((operation) => this.parseTreeOperation(operation));
    if (!operations.length) return { ...current.tree, treeVersion: current.version, sync: this.sync.status() };

    const files = new Map(current.rows.map((row) => [row.id, { ...row }]));
    let folders = new Set(current.tree.folders);
    for (const operation of operations) {
      if (operation.type === 'create-folder') {
        const path = this.folderPath(operation.path);
        const parent = parentFolders(path).at(-1) ?? '';
        if (parent && !folders.has(parent)) throw new BadRequestException('目标父文件夹不存在');
        if (folders.has(path) || [...files.values()].some((file) => file.path === path)) throw new ConflictException('目标位置已存在同名文件或目录');
        folders.add(path);
      }

      if (operation.type === 'move-file') {
        const file = files.get(operation.id);
        if (!file || file.path !== this.paths.safe(operation.fromPath) || file.revision !== operation.revision) throw new ConflictException('文件已变化，请刷新后重试');
        const destination = this.folderPath(operation.toFolder, true);
        if (destination && !folders.has(destination)) throw new BadRequestException('目标文件夹不存在');
        const path = this.paths.safe(destination ? `${destination}/${basename(file.path)}` : basename(file.path));
        if (path !== file.path) {
          if ([...files.values()].some((item) => item.id !== file.id && item.path === path) || folders.has(path)) throw new ConflictException('目标位置已有同名文件');
          file.path = path;
        }
      }

      if (operation.type === 'move-folder' || operation.type === 'rename-folder') {
        const fromPath = this.folderPath(operation.fromPath);
        const toPath = this.folderPath(operation.toPath);
        if (!folders.has(fromPath)) throw new NotFoundException('文件夹不存在');
        if (isWithin(toPath, fromPath)) throw new BadRequestException('不能将文件夹移入自身或其子文件夹');
        const targetParent = parentFolders(toPath).at(-1) ?? '';
        if (targetParent && !folders.has(targetParent)) throw new BadRequestException('目标父文件夹不存在');
        if (folders.has(toPath) || [...files.values()].some((file) => file.path === toPath)) throw new ConflictException('目标位置已有同名文件或目录');
        const movingFiles = [...files.values()].filter((file) => isWithin(file.path, fromPath));
        const movingIds = new Set(movingFiles.map((file) => file.id));
        const targets = movingFiles.map((file) => ({ file, path: `${toPath}${file.path.slice(fromPath.length)}` }));
        for (const { path } of targets) {
          if ([...files.values()].some((item) => !movingIds.has(item.id) && item.path === path)) throw new ConflictException('目标位置已有同名文件');
        }
        for (const { file, path } of targets) file.path = this.paths.safe(path);
        folders = new Set([...folders].map((folder) => isWithin(folder, fromPath) ? `${toPath}${folder.slice(fromPath.length)}` : folder));
      }

      if (operation.type === 'delete-file') {
        const file = files.get(operation.id);
        if (!file || file.path !== this.paths.safe(operation.path) || file.revision !== operation.revision) throw new ConflictException('文件已变化，请刷新后重试');
        files.delete(file.id);
      }

      if (operation.type === 'delete-folder') {
        const path = this.folderPath(operation.path);
        if (!folders.has(path)) throw new NotFoundException('文件夹不存在');
        const affected = [...files.values()].filter((file) => isWithin(file.path, path));
        if (affected.length && !operation.recursive) throw new ConflictException('文件夹非空，请确认递归删除');
        for (const file of affected) files.delete(file.id);
        folders = new Set([...folders].filter((folder) => !isWithin(folder, path)));
      }
    }

    const idByPath = new Map([...files.values()].map((file) => [file.path, file.id]));
    await this.sync.commitManagementTree({
      operations,
      idByPath,
      baseGeneration: current.generation,
      expectedFiles: current.rows.map(({ id, path, revision }) => ({ id, path, revision })),
    });
    const snapshot = await this.treeSnapshot();
    return { ...snapshot.tree, treeVersion: snapshot.version, sync: this.sync.status() };
  }

  async createFolder(path: string) {
    return this.sync.write(async () => {
      const folder = this.paths.safeFolder(path);
      await this.workspace.createFolder(folder);
      await this.sync.markDirty();
      return { path: folder, sync: this.sync.status() };
    });
  }

  async asset(path: string) {
    const safe = this.paths.safe(path);
    const row = this.workspace.indexByPath(safe);
    if (!row) throw new NotFoundException('文件不存在');
    const file = this.workspace.file(safe);
    await fs.access(file).catch(() => { throw new NotFoundException('文件不存在'); });
    return { file, mime: mimeTypes[extname(safe).toLowerCase()] ?? 'application/octet-stream', version: row.revision };
  }

  async uploadImage(sourcePath: string, image: { data: Buffer; filename: string; mimetype: string }) {
    return this.sync.write(async () => {
      const source = this.paths.safe(sourcePath, true);
      const { extension, name } = safeUploadName(image.filename);
      if (!uploadImageExtensions.has(extension)) throw new BadRequestException('不支持该图片格式');
      const kind = imageKind(image.data);
      if (!kind || !extensionMatchesImageKind(extension, kind) || !mimeMatchesImageKind(image.mimetype, kind)) throw new BadRequestException('图片内容、扩展名或 MIME 类型不匹配');

      const sourceFolder = dirname(source);
      const assetFolder = sourceFolder === '.' ? 'assets' : `${sourceFolder}/assets`;
      const stem = name.slice(0, name.length - extension.length);
      let target = this.paths.safe(`${assetFolder}/${name}`);
      let suffix = 2;
      while (this.workspace.indexByPath(target) || await this.workspace.pathExists(target)) {
        target = this.paths.safe(`${assetFolder}/${stem}-${suffix}${extension}`);
        suffix += 1;
      }

      await this.workspace.writeAtomic(target, image.data);
      const revision = hash(image.data);
      const updatedAt = now();
      const result = { id: randomUUID(), path: target, revision, assetVersion: revision, updated_at: updatedAt, title: basename(target) };
      this.database.db.prepare('INSERT INTO file_index(id,path,revision,title,kind,updated_at) VALUES(?,?,?,?,?,?)').run(result.id, result.path, result.revision, result.title, extension.slice(1), updatedAt);
      await this.sync.markDirty();
      return result;
    });
  }

  async save(path: string, content: string, revision?: string, id?: string) {
    return this.sync.write(async () => {
      const safe = this.paths.safe(path, true);
      const current = id ? this.workspace.indexById(id) : this.workspace.indexByPath(safe);
      if (current && revision && current.revision !== revision) throw new ConflictException({ message: '服务端笔记已变化', revision: current.revision });
      if (!current && revision) throw new NotFoundException('笔记不存在');
      const target = this.titlePath(current?.path ?? safe, content);
      const occupied = this.workspace.indexByPath(target);
      if (occupied && occupied.id !== current?.id) throw new ConflictException('同名笔记已存在，请修改标题');
      if (target !== current?.path && await this.workspace.pathExists(target)) throw new ConflictException('目标位置已存在同名文件或目录');

      const result = { id: current?.id ?? id ?? randomUUID(), path: target, revision: hash(content) };
      if (current) {
        await this.workspace.writeAtomic(current.path, content);
        if (target !== current.path) await this.workspace.moveFile(current.path, target);
      } else {
        await this.workspace.writeAtomic(target, content);
      }
      const updatedAt = now();
      this.database.db.prepare('INSERT OR REPLACE INTO file_index(id,path,revision,title,kind,updated_at) VALUES(?,?,?,?,?,?)').run(result.id, target, result.revision, noteTitle(target, content), 'markdown', updatedAt);
      await this.sync.markDirty();
      return { ...result, sync: this.sync.status() };
    });
  }

  async remove(path: string, revision: string, id?: string) {
    return this.sync.write(async () => {
      const safe = this.paths.safe(path);
      const current = id ? this.workspace.indexById(id) : this.workspace.indexByPath(safe);
      if (!current) throw new NotFoundException('笔记不存在');
      if (current.path !== safe || current.revision !== revision) throw new ConflictException('服务端笔记已变化');
      await this.workspace.removeFile(current.path);
      this.database.db.prepare('DELETE FROM file_index WHERE id=?').run(current.id);
      await this.sync.markDirty();
      return { sync: this.sync.status() };
    });
  }

  async render(path: string) {
    const note = await this.content(path);
    return { ...note, html: sanitizeHtml(this.md.render(note.content), { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'pre', 'code']), allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'] } }) };
  }

  search(q: string) {
    if (!q.trim()) return [];
    return this.database.db.prepare('SELECT id,path,updated_at,title,revision,revision assetVersion FROM file_index WHERE path LIKE ? OR title LIKE ? ORDER BY updated_at DESC LIMIT 50').all(`%${q}%`, `%${q}%`);
  }

  private async treeSnapshot() {
    const rows = this.workspace.indexRows();
    const files = rows.map((row) => ({ id: row.id, path: row.path, revision: row.revision, assetVersion: row.revision, updated_at: row.updated_at, title: row.title }));
    const tree = { files, folders: await this.workspace.folders() };
    const state = this.database.db.prepare('SELECT local_head,generation FROM repository_state WHERE id=1').get() as { local_head: string; generation: number };
    const version = hash(JSON.stringify({ head: state.local_head, generation: state.generation, files: rows.map((row) => [row.id, row.path, row.revision]), folders: tree.folders }));
    return { tree, version, rows, generation: state.generation };
  }

  private folderPath(value: string, allowRoot = false) {
    if (typeof value !== 'string') throw new BadRequestException('非法文件夹路径');
    const path = value.trim();
    if (!path && allowRoot) return '';
    return this.paths.safeFolder(path);
  }

  private parseTreeOperation(value: unknown): TreeOperation {
    if (!value || typeof value !== 'object') throw new BadRequestException('非法文件树操作');
    const operation = value as Record<string, unknown>;
    const text = (key: string) => {
      if (typeof operation[key] !== 'string') throw new BadRequestException('文件树操作参数不完整');
      return operation[key] as string;
    };
    if (operation.type === 'create-folder') return { type: 'create-folder', path: text('path') };
    if (operation.type === 'move-file') return { type: 'move-file', id: text('id'), fromPath: text('fromPath'), toFolder: text('toFolder'), revision: text('revision') };
    if (operation.type === 'move-folder' || operation.type === 'rename-folder') return { type: operation.type, fromPath: text('fromPath'), toPath: text('toPath') };
    if (operation.type === 'delete-file') return { type: 'delete-file', id: text('id'), path: text('path'), revision: text('revision') };
    if (operation.type === 'delete-folder') return { type: 'delete-folder', path: text('path'), recursive: operation.recursive === true };
    throw new BadRequestException('不支持的文件树操作');
  }

  private titlePath(path: string, content: string) {
    const title = noteTitle(path, content).trim();
    if (!title || title === '未命名') return path;
    const name = title.replace(/[\\/:*?"<>|\u0000]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) return path;
    const folder = dirname(path);
    return this.paths.safe(`${folder === '.' ? '' : `${folder}/`}${name}.md`, true);
  }
}
