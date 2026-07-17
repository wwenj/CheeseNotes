import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { now } from '../../common/time.js';
import { runtimeConfig } from '../../config/runtime.config.js';
import { DatabaseService } from '../database/database.service.js';
import { GitHubService } from '../github/github.service.js';

const STATE_MAX_AGE_MS = 10 * 60_000;

@Injectable()
export class OAuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(GitHubService) private readonly github: GitHubService,
  ) {}

  beginRepositoryConnection() {
    const config = runtimeConfig();
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.database.db.prepare('DELETE FROM github_oauth_states WHERE created_at < ?').run(new Date(Date.now() - STATE_MAX_AGE_MS).toISOString());
    this.database.db.prepare('INSERT INTO github_oauth_states(state,verifier,created_at) VALUES(?,?,?)').run(state, verifier, now());
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', config.githubOAuthClientId);
    url.searchParams.set('redirect_uri', config.githubOAuthCallbackUrl);
    url.searchParams.set('scope', 'repo');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString() };
  }

  async finishRepositoryConnection(code: string, state: string) {
    const verifier = this.consumeState(state);
    const config = runtimeConfig();
    const token = await this.github.exchange(config.githubOAuthClientId, config.githubOAuthClientSecret, code, verifier, config.githubOAuthCallbackUrl);
    const account = await this.github.accountForToken(token);
    this.github.saveToken(token, account);
    return { login: account.login };
  }

  connectionStatus(repository: string) {
    const connected = this.github.hasToken();
    return { connected, login: connected ? this.github.login() || null : null, repository: connected ? repository || null : null };
  }

  disconnect() {
    this.github.clearToken();
  }

  private consumeState(state: string) {
    const row = this.database.db.prepare('SELECT verifier,created_at FROM github_oauth_states WHERE state=?').get(state) as {
      verifier: string; created_at: string;
    } | undefined;
    this.database.db.prepare('DELETE FROM github_oauth_states WHERE state=?').run(state);
    if (!row || Date.now() - Date.parse(row.created_at) > STATE_MAX_AGE_MS) {
      throw new BadRequestException('GitHub 授权已过期或校验失败，请重新连接');
    }
    return row.verifier;
  }
}
