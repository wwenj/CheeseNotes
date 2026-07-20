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
    const legacyDatabasePath = join(metaRoot, 'notes.sqlite');
    const databasePath = join(metaRoot, 'noteai-git.sqlite');
    mkdirSync(metaRoot, { recursive: true });
    if (existsSync(legacyDatabasePath)) {
      throw new Error(`检测到旧运行数据库 ${legacyDatabasePath}。此版本不迁移旧数据，请停止旧服务并清空 ${config.dataRoot} 后重新从 GitHub clone。`);
    }

    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices(token_hash TEXT PRIMARY KEY, name TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS github_oauth_states(state TEXT PRIMARY KEY, verifier TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS file_index(
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        revision TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repository_state(
        id INTEGER PRIMARY KEY CHECK(id=1),
        repository TEXT NOT NULL DEFAULT '',
        branch TEXT NOT NULL DEFAULT '',
        local_head TEXT NOT NULL DEFAULT '',
        remote_head TEXT NOT NULL DEFAULT '',
        generation INTEGER NOT NULL DEFAULT 0,
        verified_generation INTEGER NOT NULL DEFAULT -1,
        dirty_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'unconfigured',
        phase TEXT NOT NULL DEFAULT 'idle',
        last_error TEXT NOT NULL DEFAULT '',
        verified_at TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        lock_token TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS sync_jobs(
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        phase TEXT NOT NULL,
        base_commit TEXT NOT NULL DEFAULT '',
        snapshot_commit TEXT NOT NULL DEFAULT '',
        candidate_commit TEXT NOT NULL DEFAULT '',
        operations TEXT NOT NULL DEFAULT '[]',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conflicts(
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        path TEXT NOT NULL,
        copy_path TEXT NOT NULL DEFAULT '',
        base_commit TEXT NOT NULL DEFAULT '',
        local_commit TEXT NOT NULL DEFAULT '',
        remote_commit TEXT NOT NULL DEFAULT '',
        base_file TEXT NOT NULL DEFAULT '',
        local_file TEXT NOT NULL DEFAULT '',
        remote_file TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        operation TEXT NOT NULL DEFAULT 'update',
        resolution_action TEXT,
        resolution_content TEXT,
        resolution_updated_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO repository_state(id,device_id) VALUES(1,lower(hex(randomblob(8))));
    `);
  }

  getSetting(key: string) {
    return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined)?.value ?? '';
  }

  setSetting(key: string, value: string) {
    return this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, value);
  }
}
