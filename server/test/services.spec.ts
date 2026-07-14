import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubService, OAuthService, PathPolicy, RepositoryService, SyncService, type DatabaseService } from '../src/services.js';

const makeDatabaseService = () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE oauth_web_states(state TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret TEXT NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE notes(path TEXT PRIMARY KEY, revision TEXT, updated_at TEXT, remote_sha TEXT); CREATE TABLE pending(path TEXT PRIMARY KEY, op TEXT, base_commit TEXT, base_blob TEXT, base_content TEXT, local_content TEXT, updated_at TEXT); CREATE TABLE conflicts(id TEXT PRIMARY KEY, path TEXT, base_content TEXT, local_content TEXT, remote_content TEXT, remote_commit TEXT, created_at TEXT); CREATE TABLE sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT, error TEXT, created_at TEXT); CREATE TABLE sync_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT, phase TEXT, error TEXT, created_at TEXT, updated_at TEXT);');
  return { db } as DatabaseService;
};

afterEach(() => vi.unstubAllGlobals());

describe('RepositoryService', () => {
  it('将 Git URL 规范为 owner/repo', () => {
    const repository = new RepositoryService(makeDatabaseService());
    expect(repository.set('git@github.com:wwenj/myNote.git')).toBe('wwenj/myNote');
    expect(repository.get()).toBe('wwenj/myNote');
    expect(repository.set('https://github.com/wwenj/myNote/')).toBe('wwenj/myNote');
  });

  it('拒绝非 GitHub 仓库地址', () => {
    const repository = new RepositoryService(makeDatabaseService());
    expect(() => repository.set('https://example.com/a/b')).toThrow('请输入 owner/repo');
  });
});

describe('OAuthService', () => {
  it('使用前端提供的 OAuth App 信息创建 PKCE 授权，并且只把 Token 存入本地 settings', async () => {
    const dbs = makeDatabaseService();
    const github = new GitHubService(dbs);
    const oauth = new OAuthService(dbs, github);
    const fetch = vi.fn(async (input: string | URL) => {
      if (String(input).includes('access_token')) return new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ login: 'wwenj' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    const authorization = oauth.beginWeb('client-id', 'client-secret');
    const url = new URL(authorization.url);
    expect(url.searchParams.get('scope')).toBe('repo');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(oauth.finishWeb('code', url.searchParams.get('state')!)).resolves.toBe('wwenj');
    expect(oauth.status('wwenj/myNote')).toEqual({ authenticated: true, login: 'wwenj', repository: 'wwenj/myNote' });
    expect(dbs.db.prepare('SELECT value FROM settings WHERE key=?').get('github_access_token')).toEqual({ value: 'oauth-token' });
    expect(dbs.db.prepare('SELECT client_secret FROM oauth_web_states').get()).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('GitHubService', () => {
  it('对临时 502 自动重试后继续请求', async () => {
    const dbs = makeDatabaseService();
    dbs.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('github_access_token', 'token');
    const github = new GitHubService(dbs);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bad Gateway' }), { status: 502, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ login: 'wwenj' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(github.user()).resolves.toEqual({ login: 'wwenj' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('PathPolicy and SyncService', () => {
  it('限制可写文件并在未连接时报告未配置状态', () => {
    const dbs = makeDatabaseService();
    const path = new PathPolicy();
    expect(path.safe('收件箱/笔记.md', true)).toBe('收件箱/笔记.md');
    expect(() => path.safe('.env')).toThrow('非法笔记路径');
    expect(() => path.safe('图片/a.png', true)).toThrow('仅允许 Markdown 写入');
    const repository = new RepositoryService(dbs);
    const github = new GitHubService(dbs);
    const sync = new SyncService(dbs, path, repository, github);
    expect(sync.triggerSync().state).toBe('unconfigured');
  });
});
