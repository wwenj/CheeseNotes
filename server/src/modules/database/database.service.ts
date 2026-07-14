import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeConfig } from '../../config/runtime.config.js';

@Injectable()
export class DatabaseService {
  readonly db: Database.Database;

  constructor() {
    const config = runtimeConfig();
    mkdirSync(join(config.dataRoot, 'meta'), { recursive: true });
    this.db = new Database(join(config.dataRoot, 'meta', 'notes.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices(token_hash TEXT PRIMARY KEY, name TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS notes(path TEXT PRIMARY KEY, revision TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS pending(path TEXT PRIMARY KEY, op TEXT, base_commit TEXT, base_blob TEXT, base_content TEXT, local_content TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS conflicts(id TEXT PRIMARY KEY, path TEXT, base_content TEXT, local_content TEXT, remote_content TEXT, remote_commit TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT, error TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_web_states(state TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret TEXT NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const noteColumns = this.db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
    if (!noteColumns.some((column) => column.name === 'remote_sha')) this.db.exec('ALTER TABLE notes ADD COLUMN remote_sha TEXT');
  }

  getSetting(key: string) {
    return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined)?.value ?? '';
  }

  setSetting(key: string, value: string) {
    return this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, value);
  }
}
