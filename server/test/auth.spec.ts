import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../src/modules/database/database.service.js';
import type { GitHubAccount, GitHubService } from '../src/modules/github/github.service.js';
import { OAuthService } from '../src/modules/auth/oauth.service.js';

vi.mock('../src/config/runtime.config.js', () => ({
  runtimeConfig: () => ({
    githubOAuthClientId: 'client-id', githubOAuthClientSecret: 'client-secret', githubOAuthCallbackUrl: 'http://localhost:3000/api/auth/github/callback',
  }),
}));

function fixture() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE github_oauth_states(state TEXT PRIMARY KEY, verifier TEXT NOT NULL, created_at TEXT NOT NULL)');
  const database = { db } as DatabaseService;
  const account: GitHubAccount = { id: 'github-42', login: 'man', avatarUrl: null, emails: [] };
  const github = {
    exchange: vi.fn().mockResolvedValue('github-token'),
    accountForToken: vi.fn().mockResolvedValue(account),
    saveToken: vi.fn(),
    hasToken: vi.fn(),
    login: vi.fn(),
    clearToken: vi.fn(),
  } as unknown as GitHubService;
  return { database, github, oauth: new OAuthService(database, github) };
}

describe('GitHub repository authorization', () => {
  it('stores a repository token after consuming a valid PKCE state', async () => {
    const { database, github, oauth } = fixture();
    database.db.prepare('INSERT INTO github_oauth_states(state,verifier,created_at) VALUES(?,?,?)')
      .run('repository', 'verifier', new Date().toISOString());

    await expect(oauth.finishRepositoryConnection('repo-code', 'repository')).resolves.toEqual({ login: 'man' });
    expect(github.exchange).toHaveBeenCalledWith('client-id', 'client-secret', 'repo-code', 'verifier', 'http://localhost:3000/api/auth/github/callback');
    expect(github.saveToken).toHaveBeenCalledWith('github-token', expect.objectContaining({ id: 'github-42', login: 'man' }));
    expect(database.db.prepare('SELECT count(*) AS count FROM github_oauth_states').get()).toEqual({ count: 0 });
  });

  it('rejects an expired or unknown repository state', async () => {
    const { oauth } = fixture();
    await expect(oauth.finishRepositoryConnection('repo-code', 'missing')).rejects.toThrow('GitHub 授权已过期或校验失败');
  });
});
