import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { now } from '../../common/time.js';
import { runtimeConfig } from '../../config/runtime.config.js';
import { DatabaseService } from '../database/database.service.js';
import { GitHubService } from '../github/github.service.js';

@Injectable()
export class OAuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(GitHubService) private readonly github: GitHubService,
  ) {}

  beginWeb(clientId: string, clientSecret: string) {
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    const secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
    if (id.length < 4 || id.length > 200 || !secret) throw new BadRequestException('请填写 GitHub OAuth App Client ID 与 Client Secret');
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.database.db.prepare('DELETE FROM oauth_web_states WHERE created_at < ?').run(new Date(Date.now() - 10 * 60_000).toISOString());
    this.database.db.prepare('INSERT INTO oauth_web_states(state,client_id,client_secret,verifier,created_at) VALUES(?,?,?,?,?)').run(state, id, secret, verifier, now());
    const config = runtimeConfig();
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', id);
    url.searchParams.set('redirect_uri', config.githubOAuthCallbackUrl);
    url.searchParams.set('scope', 'repo');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString() };
  }

  async finishWeb(code: string, state: string) {
    const row = this.database.db.prepare('SELECT client_id,client_secret,verifier,created_at FROM oauth_web_states WHERE state=?').get(state) as { client_id: string; client_secret: string; verifier: string; created_at: string } | undefined;
    this.database.db.prepare('DELETE FROM oauth_web_states WHERE state=?').run(state);
    if (!row || Date.now() - Date.parse(row.created_at) > 10 * 60_000) throw new BadRequestException('GitHub 授权已过期或校验失败，请重新连接');
    const token = await this.github.exchange(row.client_id, row.client_secret, code, row.verifier, runtimeConfig().githubOAuthCallbackUrl);
    const login = await this.github.userForToken(token);
    this.github.saveToken(token, login);
    return login;
  }

  status(repository: string) {
    return { authenticated: this.github.hasToken(), login: this.github.login() || null, repository: repository || null };
  }

  disconnect() {
    this.github.clearToken();
  }
}
