import type Database from 'better-sqlite3';

export const getSetting = (db: Database.Database, key: string) => (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined)?.value ?? '';

export const setSetting = (db: Database.Database, key: string, value: string) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, value);
