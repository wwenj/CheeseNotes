import { ConflictException, Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { promises as fs } from 'node:fs';
import { dirname, extname } from 'node:path';
import { hash } from '../../common/crypto.js';
import { isText, mimeTypes } from '../../common/file-types.js';
import { noteTitle } from '../../common/note-title.js';
import { now } from '../../common/time.js';
import { DatabaseService } from '../database/database.service.js';
import { FileStoreService } from '../storage/file-store.service.js';
import { PathPolicy } from '../storage/path-policy.service.js';
import { SyncService } from '../sync/sync.service.js';

type NoteRow = { id: string; path: string; revision: string; updated_at: string; title: string | null; content: string | null; remote_sha: string | null; dirty: number; deleted: number };
type TreeEntry = { id: string; path: string; revision: string; assetVersion: string; updated_at: string; title: string };
type NoteTree = { files: TreeEntry[]; folders: string[] };

function parentFolders(path: string, includePath = false) {
  const parts = path.split('/').filter(Boolean);
  const limit = includePath ? parts.length : parts.length - 1;
  return Array.from({ length: limit }, (_, index) => parts.slice(0, index + 1).join('/'));
}

@Injectable()
export class NoteService {
  private readonly md = new MarkdownIt({ html: false, linkify: true });

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PathPolicy) private readonly paths: PathPolicy,
    @Inject(FileStoreService) private readonly files: FileStoreService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  async content(path: string) {
    const safe = this.paths.safe(path);
    if (!isText(safe)) throw new BadRequestException('该文件不能作为文本笔记打开');
    const row = this.database.db.prepare('SELECT id,path,content,revision FROM notes WHERE path=? AND deleted=0').get(safe) as { id: string; path: string; content: string | null; revision: string } | undefined;
    if (!row) throw new NotFoundException('笔记不存在');
    if (row.content === null) throw new BadRequestException('该文件不能作为文本笔记打开');
    return { id: row.id, path: row.path, content: row.content, revision: row.revision };
  }

  async tree(): Promise<NoteTree> {
    const rows = this.database.db.prepare('SELECT id,path,revision,updated_at,title,remote_sha FROM notes WHERE deleted=0 ORDER BY path').all() as Array<NoteRow & { remote_sha: string | null }>;
    const files = rows.map((row) => ({ id: row.id, path: row.path, revision: row.revision, assetVersion: row.remote_sha ?? row.revision, updated_at: row.updated_at, title: row.title ?? noteTitle(row.path, row.content ?? '') }));
    const localFolders = (this.database.db.prepare('SELECT path FROM local_folders').all() as Array<{ path: string }>).map((folder) => folder.path);
    const visibleFolders = new Set([...files.flatMap((file) => parentFolders(file.path)), ...localFolders.flatMap((folder) => parentFolders(folder, true))]);
    return { files, folders: [...visibleFolders].sort() };
  }

  async createFolder(path: string) {
    const folder = this.paths.safeFolder(path);
    if (!await this.files.createFolder(folder)) throw new ConflictException('文件夹已存在');
    this.database.db.prepare('INSERT OR IGNORE INTO local_folders(path,created_at) VALUES(?,?)').run(folder, now());
    return { path: folder, sync: this.sync.status() };
  }

  async asset(path: string) {
    const safe = this.paths.safe(path);
    const file = this.files.file(safe);
    await fs.access(file).catch(() => this.sync.ensureAsset(safe));
    await fs.access(file).catch(() => { throw new NotFoundException('文件不存在'); });
    const row = this.database.db.prepare('SELECT revision,remote_sha FROM notes WHERE path=? AND deleted=0').get(safe) as { revision?: string; remote_sha?: string | null } | undefined;
    return { file, mime: mimeTypes[extname(safe).toLowerCase()] ?? 'application/octet-stream', version: row?.remote_sha ?? row?.revision ?? hash(safe) };
  }

  async save(path: string, content: string, revision?: string, id?: string) {
    const safe = this.paths.safe(path, true);
    const current = (id
      ? this.database.db.prepare('SELECT * FROM notes WHERE id=? AND deleted=0').get(id)
      : this.database.db.prepare('SELECT * FROM notes WHERE path=? AND deleted=0').get(safe)) as (NoteRow & { remote_path: string | null; base_content: string | null }) | undefined;
    if (current && revision && current.revision !== revision) throw new ConflictException({ message: '服务端笔记已变化', revision: current.revision });
    if (!current && !revision && this.database.db.prepare('SELECT 1 FROM notes WHERE path=? AND deleted=0').get(safe)) throw new ConflictException('笔记已存在');
    const target = this.titlePath(current?.path ?? safe, content);
    const occupied = this.database.db.prepare('SELECT id FROM notes WHERE path=? AND deleted=0').get(target) as { id: string } | undefined;
    if (occupied && occupied.id !== current?.id) throw new ConflictException('同名笔记已存在，请修改标题');
    const result = { id: current?.id ?? randomUUID(), path: target, revision: hash(content) };
    this.database.db.transaction(() => {
      if (current) this.database.db.prepare('UPDATE notes SET path=?,content=?,revision=?,title=?,dirty=1,deleted=0,updated_at=? WHERE id=?').run(target, content, result.revision, noteTitle(target, content), now(), current.id);
      else this.database.db.prepare('INSERT INTO notes(id,path,revision,updated_at,remote_sha,title,content,remote_path,base_content,dirty,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)').run(result.id, target, result.revision, now(), null, noteTitle(target, content), content, null, null, 1);
      this.database.db.prepare('UPDATE sync_workspace SET generation=generation+1,updated_at=? WHERE id=1').run(now());
    })();
    this.sync.schedule();
    return { ...result, sync: this.sync.status() };
  }

  async remove(path: string, revision: string, id?: string) {
    const safe = this.paths.safe(path, true);
    const current = (id ? this.database.db.prepare('SELECT * FROM notes WHERE id=? AND deleted=0').get(id) : this.database.db.prepare('SELECT * FROM notes WHERE path=? AND deleted=0').get(safe)) as NoteRow | undefined;
    if (!current) throw new NotFoundException('笔记不存在');
    if (current.revision !== revision) throw new ConflictException('服务端笔记已变化');
    this.database.db.transaction(() => {
      this.database.db.prepare('UPDATE notes SET deleted=1,dirty=1,revision=?,updated_at=? WHERE id=?').run(hash(`deleted:${current.id}:${now()}`), now(), current.id);
      this.database.db.prepare('UPDATE sync_workspace SET generation=generation+1,updated_at=? WHERE id=1').run(now());
    })();
    this.sync.schedule();
    return { sync: this.sync.status() };
  }

  async render(path: string) {
    const note = await this.content(path);
    return { ...note, html: sanitizeHtml(this.md.render(note.content), { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'pre', 'code']), allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'] } }) };
  }

  search(q: string) {
    if (!q.trim()) return [];
    return this.database.db.prepare('SELECT id,path,updated_at,title,revision,COALESCE(remote_sha,revision) assetVersion FROM notes WHERE deleted=0 AND (path LIKE ? OR title LIKE ?) LIMIT 50').all(`%${q}%`, `%${q}%`);
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
