import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { now } from '../../common/time.js';
import { runtimeConfig } from '../../config/runtime.config.js';
import { DatabaseService } from '../database/database.service.js';
import { GitHubService, type GitHubAccount } from '../github/github.service.js';

const ALLOWED_EMAIL = 'man@wwenj.com';
const STATE_MAX_AGE_MS = 10 * 60_000;
const MOBILE_HANDOFF_MAX_AGE_MS = 60_000;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

type OAuthPurpose = 'login' | 'repository';
export type OAuthClient = 'web' | 'ios';
type OAuthState = { verifier: string; purpose: OAuthPurpose; client: OAuthClient; userId: string; createdAt: string };

export type SessionUser = {
  id: string;
  githubId: string;
  login: string;
  email: string;
  avatarUrl: string | null;
};

export type LoginResult = { purpose: 'login'; client: OAuthClient; user: SessionUser; sessionToken?: string };
export type RepositoryResult = { purpose: 'repository'; client: OAuthClient; login: string };
export type OAuthResult = LoginResult | RepositoryResult;
export type MobileSessionResult = { token: string; expiresAt: string; user: SessionUser };

export class GitHubAccessDeniedError extends Error {
  constructor() {
    super('当前 GitHub 账号没有使用权限');
  }
}

@Injectable()
export class OAuthService {
  static readonly sessionCookieName = 'noteai_session';

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(GitHubService) private readonly github: GitHubService,
  ) {}

  beginLogin(client: OAuthClient = 'web') {
    return this.begin('login', client);
  }

  beginRepositoryConnection(client: OAuthClient = 'web') {
    return this.begin('repository', client);
  }

  async finishWeb(code: string, state: string): Promise<OAuthResult> {
    const row = this.consumeState(state);
    const config = runtimeConfig();

    const token = await this.github.exchange(config.githubOAuthClientId, config.githubOAuthClientSecret, code, row.verifier, config.githubOAuthCallbackUrl);
    if (row.purpose === 'login') {
      const account = await this.github.accountForToken(token, true);
      const email = this.allowedEmail(account);
      if (!email) throw new GitHubAccessDeniedError();
      const user = this.upsertUser(account, email);
      return { purpose: 'login', client: row.client, user, ...(row.client === 'web' ? { sessionToken: this.createSession(user.id).token } : {}) };
    }

    const account = await this.github.accountForToken(token);
    this.github.saveToken(token, account);
    return { purpose: 'repository', client: row.client, login: account.login };
  }

  clientForState(state: string | undefined): OAuthClient {
    if (!state) return 'web';
    const row = this.database.db.prepare('SELECT client FROM oauth_web_states WHERE state=?').get(state) as { client?: string } | undefined;
    return row?.client === 'ios' ? 'ios' : 'web';
  }

  purposeForState(state: string | undefined): OAuthPurpose {
    if (!state) return 'login';
    const row = this.database.db.prepare('SELECT purpose FROM oauth_web_states WHERE state=?').get(state) as { purpose?: string } | undefined;
    return row?.purpose === 'repository' ? 'repository' : 'login';
  }

  session(token: string | undefined): SessionUser | null {
    if (!token) return null;
    const current = now();
    this.database.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(current);
    const row = this.database.db.prepare(`
      SELECT u.id, u.github_id, u.github_login, u.email, u.avatar_url
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(this.tokenHash(token), current) as {
      id: string; github_id: string; github_login: string; email: string; avatar_url: string;
    } | undefined;
    return row ? this.toSessionUser(row) : null;
  }

  logout(token: string | undefined) {
    if (token) this.database.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(this.tokenHash(token));
  }

  createMobileHandoff(userId: string) {
    const handoff = randomBytes(32).toString('base64url');
    const timestamp = now();
    this.database.db.prepare('DELETE FROM mobile_auth_handoffs WHERE expires_at <= ?').run(timestamp);
    this.database.db.prepare('INSERT INTO mobile_auth_handoffs(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .run(this.tokenHash(handoff), userId, timestamp, new Date(Date.now() + MOBILE_HANDOFF_MAX_AGE_MS).toISOString());
    return handoff;
  }

  exchangeMobileHandoff(handoff: string): MobileSessionResult {
    const timestamp = now();
    const hash = this.tokenHash(handoff);
    const row = this.database.db.prepare(`
      SELECT u.id, u.github_id, u.github_login, u.email, u.avatar_url
      FROM mobile_auth_handoffs h JOIN users u ON u.id = h.user_id
      WHERE h.token_hash = ? AND h.expires_at > ?
    `).get(hash, timestamp) as {
      id: string; github_id: string; github_login: string; email: string; avatar_url: string;
    } | undefined;
    this.database.db.prepare('DELETE FROM mobile_auth_handoffs WHERE token_hash = ? OR expires_at <= ?').run(hash, timestamp);
    if (!row) throw new BadRequestException('移动端登录已过期，请重新使用 GitHub 登录');
    const token = this.createSession(row.id);
    return { token: token.token, expiresAt: token.expiresAt, user: this.toSessionUser(row) };
  }

  connectionStatus(repository: string) {
    const connected = this.github.hasToken();
    return { connected, login: connected ? this.github.login() || null : null, repository: connected ? repository || null : null };
  }

  disconnect() {
    this.github.clearToken();
  }

  private begin(purpose: OAuthPurpose, client: OAuthClient, userId = '') {
    const config = runtimeConfig();
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.database.db.prepare('DELETE FROM oauth_web_states WHERE created_at < ?').run(new Date(Date.now() - STATE_MAX_AGE_MS).toISOString());
    this.database.db.prepare('INSERT INTO oauth_web_states(state,client_id,client_secret,verifier,purpose,user_id,client,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(state, config.githubOAuthClientId, '', verifier, purpose, userId, client, now());
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', config.githubOAuthClientId);
    url.searchParams.set('redirect_uri', config.githubOAuthCallbackUrl);
    url.searchParams.set('scope', purpose === 'login' ? 'read:user user:email' : 'repo');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString() };
  }

  private consumeState(state: string): OAuthState {
    const row = this.database.db.prepare('SELECT verifier,purpose,user_id,client,created_at FROM oauth_web_states WHERE state=?').get(state) as {
      verifier: string; purpose: string; user_id: string; client: string; created_at: string;
    } | undefined;
    this.database.db.prepare('DELETE FROM oauth_web_states WHERE state=?').run(state);
    if (!row || Date.now() - Date.parse(row.created_at) > STATE_MAX_AGE_MS || (row.purpose !== 'login' && row.purpose !== 'repository') || (row.client !== 'web' && row.client !== 'ios')) {
      throw new BadRequestException('GitHub 授权已过期或校验失败，请重新连接');
    }
    return { verifier: row.verifier, purpose: row.purpose, client: row.client, userId: row.user_id, createdAt: row.created_at };
  }

  private allowedEmail(account: GitHubAccount) {
    return account.emails.find((item) => item.verified && item.email.toLowerCase() === ALLOWED_EMAIL)?.email ?? null;
  }

  private upsertUser(account: GitHubAccount, email: string): SessionUser {
    const timestamp = now();
    this.database.db.prepare(`
      INSERT INTO users(id,github_id,github_login,email,avatar_url,created_at,last_login_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(github_id) DO UPDATE SET github_login=excluded.github_login,email=excluded.email,avatar_url=excluded.avatar_url,last_login_at=excluded.last_login_at
    `).run(randomUUID(), account.id, account.login, email, account.avatarUrl ?? '', timestamp, timestamp);
    const user = this.database.db.prepare('SELECT id,github_id,github_login,email,avatar_url FROM users WHERE github_id=?').get(account.id) as {
      id: string; github_id: string; github_login: string; email: string; avatar_url: string;
    } | undefined;
    if (!user) throw new BadRequestException('无法保存本地登录账号');
    return this.toSessionUser(user);
  }

  private createSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const timestamp = now();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
    this.database.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp);
    this.database.db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(this.tokenHash(token), userId, timestamp, expiresAt);
    return { token, expiresAt };
  }

  private toSessionUser(row: { id: string; github_id: string; github_login: string; email: string; avatar_url: string }): SessionUser {
    return { id: row.id, githubId: row.github_id, login: row.github_login, email: row.email, avatarUrl: row.avatar_url || null };
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
