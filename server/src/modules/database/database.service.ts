import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeConfig } from '../../config/runtime.config.js';

@Injectable()
export class DatabaseService {
  readonly db: Database.Database;

  constructor() {
    const config = runtimeConfig();
    const metaRoot = join(config.dataRoot, 'meta');
    const databasePath = join(metaRoot, 'notes.sqlite');
    mkdirSync(metaRoot, { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    const hasNotes = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes'").get());
    const hasWorkspace = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_workspace'").get());
    const hasCanonicalContent = hasNotes && (this.db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>).some((column) => column.name === 'content');
    if (hasNotes && (!hasWorkspace || !hasCanonicalContent)) {
      const backupRoot = join(metaRoot, 'backups');
      const backupPath = join(backupRoot, 'notes-before-sync-v2.sqlite');
      mkdirSync(backupRoot, { recursive: true });
      if (!existsSync(backupPath)) this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices(token_hash TEXT PRIMARY KEY, name TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS notes(path TEXT PRIMARY KEY, revision TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS local_folders(path TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending(path TEXT PRIMARY KEY, op TEXT, base_commit TEXT, base_blob TEXT, base_content TEXT, local_content TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS conflicts(id TEXT PRIMARY KEY, path TEXT, base_content TEXT, local_content TEXT, remote_content TEXT, remote_commit TEXT, created_at TEXT, operation TEXT, resolution_action TEXT, resolution_content TEXT, resolution_copy_path TEXT, resolution_updated_at TEXT);
      CREATE TABLE IF NOT EXISTS sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT, error TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_web_states(state TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret TEXT NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_workspace(
        id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL DEFAULT 0,
        verified_generation INTEGER NOT NULL DEFAULT -1, last_remote_head TEXT NOT NULL DEFAULT '',
        verified_remote_head TEXT NOT NULL DEFAULT '', verified_at TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'pending', phase TEXT NOT NULL DEFAULT 'idle',
        last_error TEXT NOT NULL DEFAULT '', next_retry_at TEXT NOT NULL DEFAULT '',
        lock_token TEXT NOT NULL DEFAULT '', lock_until TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
    const noteColumns = this.db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
    const noteAdditions: Array<[string, string]> = [
      ['remote_sha', 'TEXT'], ['title', 'TEXT'], ['id', 'TEXT'], ['content', 'TEXT'],
      ['remote_path', 'TEXT'], ['base_content', 'TEXT'], ['dirty', 'INTEGER NOT NULL DEFAULT 0'],
      ['deleted', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [name, type] of noteAdditions) {
      if (!noteColumns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE notes ADD COLUMN ${name} ${type}`);
    }
    const conflictColumns = this.db.prepare('PRAGMA table_info(conflicts)').all() as Array<{ name: string }>;
    const missingConflictColumns: Array<[string, string]> = [
      ['operation', 'TEXT'],
      ['resolution_action', 'TEXT'],
      ['resolution_content', 'TEXT'],
      ['resolution_copy_path', 'TEXT'],
      ['resolution_updated_at', 'TEXT'],
    ];
    for (const [name, type] of missingConflictColumns) {
      if (!conflictColumns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE conflicts ADD COLUMN ${name} ${type}`);
    }
    this.db.prepare("INSERT OR IGNORE INTO sync_workspace(id,updated_at) VALUES(1,'')").run();
    this.db.prepare("UPDATE sync_workspace SET device_id=lower(hex(randomblob(8))) WHERE id=1 AND device_id=''").run();
  }

  getSetting(key: string) {
    return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined)?.value ?? '';
  }

  setSetting(key: string, value: string) {
    return this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, value);
  }
}
