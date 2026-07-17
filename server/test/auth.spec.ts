import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../src/modules/database/database.service.js';
import type { GitHubAccount, GitHubService } from '../src/modules/github/github.service.js';
import { GitHubAccessDeniedError, OAuthService } from '../src/modules/auth/oauth.service.js';
import { SessionGuard } from '../src/modules/auth/session.guard.js';

vi.mock('../src/config/runtime.config.js', () => ({
  runtimeConfig: () => ({
    githubOAuthClientId: 'client-id', githubOAuthClientSecret: 'client-secret', githubOAuthCallbackUrl: 'http://localhost:3000/api/auth/github/callback',
  }),
}));

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, github_id TEXT NOT NULL UNIQUE, github_login TEXT NOT NULL, email TEXT NOT NULL, avatar_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_login_at TEXT NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE mobile_auth_handoffs(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE oauth_web_states(state TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret TEXT NOT NULL, verifier TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'repository', user_id TEXT NOT NULL DEFAULT '', client TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL);
  `);
  return { db } as DatabaseService;
}

const account = (overrides: Partial<GitHubAccount> = {}): GitHubAccount => ({
  id: 'github-42', login: 'man', avatarUrl: null, emails: [{ email: 'man@wwenj.com', verified: true }], ...overrides,
});

function state(db: DatabaseService, value: string, purpose: 'login' | 'repository', userId = '', client: 'web' | 'ios' = 'web') {
  db.db.prepare('INSERT INTO oauth_web_states(state,client_id,client_secret,verifier,purpose,user_id,client,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(value, 'client-id', '', 'verifier', purpose, userId, client, new Date().toISOString());
}

function fixture() {
  const db = database();
  const github = {
    exchange: vi.fn().mockResolvedValue('github-token'),
    accountForToken: vi.fn().mockResolvedValue(account()),
    saveToken: vi.fn(),
    hasConnectionFor: vi.fn(),
    hasToken: vi.fn(),
    login: vi.fn(),
    clearToken: vi.fn(),
  } as unknown as GitHubService;
  return { db, github, oauth: new OAuthService(db, github) };
}

describe('GitHub whitelist login', () => {
  it('accepts a verified private email, upserts the GitHub identity, and creates a local session', async () => {
    const { db, github, oauth } = fixture();
    state(db, 'login-1', 'login');

    const result = await oauth.finishWeb('code', 'login-1');

    expect(result.purpose).toBe('login');
    if (result.purpose !== 'login') throw new Error('expected login result');
    expect(result.user).toMatchObject({ githubId: 'github-42', login: 'man', email: 'man@wwenj.com' });
    expect(result.sessionToken).toBeTruthy();
    expect(oauth.session(result.sessionToken)).toEqual(result.user);
    expect(github.accountForToken).toHaveBeenCalledWith('github-token', true);
    expect(db.db.prepare('SELECT count(*) AS count FROM users').get()).toEqual({ count: 1 });
  });

  it('denies an unverified or non-whitelisted email without persisting a user or session', async () => {
    const { db, github, oauth } = fixture();
    state(db, 'login-unverified', 'login');
    (github.accountForToken as ReturnType<typeof vi.fn>).mockResolvedValue(account({ emails: [{ email: 'man@wwenj.com', verified: false }] }));

    await expect(oauth.finishWeb('code', 'login-unverified')).rejects.toBeInstanceOf(GitHubAccessDeniedError);
    expect(db.db.prepare('SELECT count(*) AS count FROM users').get()).toEqual({ count: 0 });
    expect(db.db.prepare('SELECT count(*) AS count FROM sessions').get()).toEqual({ count: 0 });

    state(db, 'login-foreign', 'login');
    (github.accountForToken as ReturnType<typeof vi.fn>).mockResolvedValue(account({ emails: [{ email: 'other@example.com', verified: true }] }));
    await expect(oauth.finishWeb('code', 'login-foreign')).rejects.toBeInstanceOf(GitHubAccessDeniedError);
  });

  it('keeps the same local account when the GitHub user logs in again', async () => {
    const { db, github, oauth } = fixture();
    state(db, 'login-first', 'login');
    const first = await oauth.finishWeb('code', 'login-first');
    if (first.purpose !== 'login') throw new Error('expected login result');

    state(db, 'login-second', 'login');
    (github.accountForToken as ReturnType<typeof vi.fn>).mockResolvedValue(account({ login: 'man-renamed' }));
    const second = await oauth.finishWeb('code', 'login-second');
    if (second.purpose !== 'login') throw new Error('expected login result');

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.login).toBe('man-renamed');
    expect(db.db.prepare('SELECT count(*) AS count FROM users').get()).toEqual({ count: 1 });
  });

  it('creates and consumes a short-lived mobile handoff without invalidating the web session', async () => {
    const { db, oauth } = fixture();
    state(db, 'web-login', 'login');
    const web = await oauth.finishWeb('code', 'web-login');
    if (web.purpose !== 'login' || !web.sessionToken) throw new Error('expected web login');

    state(db, 'ios-login', 'login', '', 'ios');
    const mobile = await oauth.finishWeb('code', 'ios-login');
    if (mobile.purpose !== 'login') throw new Error('expected mobile login');
    expect(mobile.client).toBe('ios');
    expect(mobile.sessionToken).toBeUndefined();

    const handoff = oauth.createMobileHandoff(mobile.user.id);
    const session = oauth.exchangeMobileHandoff(handoff);
    expect(oauth.session(web.sessionToken)).toEqual(web.user);
    expect(oauth.session(session.token)).toEqual(mobile.user);
    expect(db.db.prepare('SELECT count(*) AS count FROM sessions').get()).toEqual({ count: 2 });
    expect(() => oauth.exchangeMobileHandoff(handoff)).toThrow('移动端登录已过期');
  });

  it('stores a repository token without requiring a local login session', async () => {
    const { db, github, oauth } = fixture();
    state(db, 'repository', 'repository');

    const result = await oauth.finishWeb('repo-code', 'repository');

    expect(result).toEqual({ purpose: 'repository', client: 'web', login: 'man' });
    expect(github.saveToken).toHaveBeenCalledWith('github-token', expect.objectContaining({ id: 'github-42', login: 'man' }));

    state(db, 'repository-ios', 'repository', '', 'ios');
    await expect(oauth.finishWeb('repo-code', 'repository-ios')).resolves.toEqual({ purpose: 'repository', client: 'ios', login: 'man' });
  });
});

describe('SessionGuard', () => {
  it('allows every route while system login is disabled', () => {
    const guard = new SessionGuard();
    const request = { cookies: {} };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('does not inspect a legacy bearer token', () => {
    const guard = new SessionGuard();
    const request = { cookies: {}, headers: { authorization: 'Bearer mobile-session-token' } };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    expect(guard.canActivate(context)).toBe(true);
  });
});
