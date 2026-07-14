import { ConflictException, Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { hash } from '../../common/crypto.js';
import { isText, mimeTypes } from '../../common/file-types.js';
import { now } from '../../common/time.js';
import { DatabaseService } from '../database/database.service.js';
import { FileStoreService } from '../storage/file-store.service.js';
import { PathPolicy } from '../storage/path-policy.service.js';
import { SyncService } from '../sync/sync.service.js';

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
    const content = await this.files.readText(safe).catch(() => {
      throw new NotFoundException('笔记不存在');
    });
    return { path: safe, content, revision: hash(content) };
  }

  tree() {
    return this.database.db.prepare('SELECT path,revision,updated_at FROM notes ORDER BY path').all();
  }

  async asset(path: string) {
    const safe = this.paths.safe(path);
    const file = this.files.file(safe);
    await fs.access(file).catch(() => this.sync.ensureAsset(safe));
    await fs.access(file).catch(() => {
      throw new NotFoundException('文件不存在');
    });
    return { file, mime: mimeTypes[extname(safe).toLowerCase()] ?? 'application/octet-stream' };
  }

  async save(path: string, content: string, revision?: string) {
    const safe = this.paths.safe(path, true);
    const old = await this.files.readText(safe).catch(() => null);
    if (old !== null && revision && hash(old) !== revision) throw new ConflictException({ message: '服务端笔记已变化', revision: hash(old) });
    await this.files.writeAtomic(safe, content);
    const remoteSha = (this.database.db.prepare('SELECT remote_sha FROM notes WHERE path=?').get(safe) as { remote_sha?: string } | undefined)?.remote_sha ?? null;
    this.database.db.prepare('INSERT OR REPLACE INTO notes(path,revision,updated_at,remote_sha) VALUES(?,?,?,?)').run(safe, hash(content), now(), remoteSha);
    this.sync.record(safe, old === null ? 'create' : 'update', content, old);
    return { path: safe, revision: hash(content), sync: this.sync.status() };
  }

  async remove(path: string, revision: string) {
    const note = await this.content(path);
    if (note.revision !== revision) throw new ConflictException('服务端笔记已变化');
    await this.files.remove(note.path);
    this.database.db.prepare('DELETE FROM notes WHERE path=?').run(note.path);
    this.sync.record(note.path, 'delete', null, note.content);
    return { sync: this.sync.status() };
  }

  async render(path: string) {
    const note = await this.content(path);
    return { ...note, html: sanitizeHtml(this.md.render(note.content), { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'pre', 'code']), allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'] } }) };
  }

  search(q: string) {
    if (!q.trim()) return [];
    return this.database.db.prepare('SELECT path,updated_at FROM notes WHERE path LIKE ? LIMIT 50').all(`%${q}%`);
  }
}
