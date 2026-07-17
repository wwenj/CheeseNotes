import Database from 'better-sqlite3';
import { UnauthorizedException } from '@nestjs/common';
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
    CREATE TABLE oauth_web_states(state TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret TEXT NOT NULL, verifier TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'repository', user_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  `);
  return { db } as DatabaseService;
}

const account = (overrides: Partial<GitHubAccount> = {}): GitHubAccount => ({
  id: 'github-42', login: 'man', avatarUrl: null, emails: [{ email: 'man@wwenj.com', verified: true }], ...overrides,
});

function state(db: DatabaseService, value: string, purpose: 'login' | 'repository', userId = '') {
  db.db.prepare('INSERT INTO oauth_web_states(state,client_id,client_secret,verifier,purpose,user_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(value, 'client-id', '', 'verifier', purpose, userId, new Date().toISOString());
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

  it('only stores a repository token when its GitHub identity matches the signed-in user', async () => {
    const { db, github, oauth } = fixture();
    state(db, 'login-user', 'login');
    const login = await oauth.finishWeb('code', 'login-user');
    if (login.purpose !== 'login') throw new Error('expected login result');
    state(db, 'repository', 'repository', login.user.id);

    const result = await oauth.finishWeb('repo-code', 'repository', login.user.id);

    expect(result).toEqual({ purpose: 'repository', login: 'man' });
    expect(github.saveToken).toHaveBeenCalledWith('github-token', expect.objectContaining({ id: 'github-42', login: 'man' }));
  });
});

describe('SessionGuard', () => {
  it('allows public routes and rejects protected routes without a session', () => {
    const oauth = { session: vi.fn().mockReturnValue(null) } as unknown as OAuthService;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false) } as never;
    const guard = new SessionGuard(reflector, oauth);
    const request = { cookies: {} };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
