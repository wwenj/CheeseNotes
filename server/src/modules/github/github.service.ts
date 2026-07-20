import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { getSetting, setSetting } from '../../common/database-settings.js';
import { wait } from '../../common/time.js';
import { runtimeConfig } from '../../config/runtime.config.js';
import { DatabaseService } from '../database/database.service.js';
import type { RepoMeta } from './contracts/github.types.js';

export type GitHubAccount = {
  id: string;
  login: string;
  avatarUrl: string | null;
  emails: Array<{ email: string; verified: boolean }>;
};

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

@Injectable()
export class GitHubService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  hasToken() {
    return Boolean(getSetting(this.database.db, 'github_access_token') && this.accountId());
  }

  login() {
    return getSetting(this.database.db, 'github_login');
  }

  accountId() {
    return getSetting(this.database.db, 'github_account_id');
  }

  accessToken() {
    const token = getSetting(this.database.db, 'github_access_token');
    if (!token || !this.accountId()) throw new UnauthorizedException('请先连接 GitHub');
    return token;
  }

  hasConnectionFor(githubId: string) {
    return this.hasToken() && this.accountId() === githubId;
  }

  clearToken() {
    setSetting(this.database.db, 'github_access_token', '');
    setSetting(this.database.db, 'github_login', '');
    setSetting(this.database.db, 'github_account_id', '');
  }

  saveToken(token: string, account: Pick<GitHubAccount, 'id' | 'login'>) {
    setSetting(this.database.db, 'github_access_token', token);
    setSetting(this.database.db, 'github_login', account.login);
    setSetting(this.database.db, 'github_account_id', account.id);
  }

  cloneUrl(fullName: string) {
    if (runtimeConfig().gitTransport === 'ssh') return `git@github.com:${fullName}.git`;
    return `https://github.com/${fullName}.git`;
  }

  async user() {
    return this.json<{ login: string }>('/user');
  }

  async repositories(page = 1, perPage = 100) {
    const rows = await this.json<Array<{ full_name: string; private: boolean; default_branch: string; permissions?: { push?: boolean }; updated_at: string }>>(`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&page=${page}&per_page=${Math.min(Math.max(perPage, 1), 100)}`);
    return rows.filter((row) => row.permissions?.push).map((row) => ({ fullName: row.full_name, private: row.private, branch: row.default_branch, updatedAt: row.updated_at }));
  }

  async repository(fullName: string) {
    const repo = await this.json<RepoMeta>(`/repos/${fullName}`);
    if (!repo.permissions?.push) throw new BadRequestException('当前 GitHub 账号没有该仓库的写入权限');
    return repo;
  }

  async accountForToken(token: string, includeEmails = false): Promise<GitHubAccount> {
    const response = await fetch('https://api.github.com/user', { headers: this.headers(token) });
    const payload = await response.json().catch(() => ({})) as { id?: number; login?: string; avatar_url?: string | null; message?: string };
    if (!response.ok || !payload.login || !payload.id) throw new UnauthorizedException(payload.message || 'GitHub Token 无效');
    const emails = includeEmails ? await this.emailsForToken(token) : [];
    return { id: String(payload.id), login: payload.login, avatarUrl: payload.avatar_url ?? null, emails };
  }

  async exchange(clientId: string, clientSecret: string, code: string, verifier: string, redirectUri: string) {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri }),
    });
    const payload = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string; error?: string };
    if (!response.ok || !payload.access_token) throw new BadRequestException(payload.error_description || payload.error || 'GitHub 授权失败');
    return payload.access_token;
  }

  private headers(token = this.accessToken()) {
    return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'note-service' };
  }

  private async emailsForToken(token: string) {
    const response = await fetch('https://api.github.com/user/emails', { headers: this.headers(token) });
    const payload = await response.json().catch(() => []) as Array<{ email?: string; verified?: boolean }> | { message?: string };
    if (!response.ok || !Array.isArray(payload)) {
      const message = Array.isArray(payload) ? '' : payload.message;
      throw new UnauthorizedException(message || '无法读取 GitHub 已验证邮箱');
    }
    return payload
      .filter((item): item is { email: string; verified: boolean } => typeof item.email === 'string' && typeof item.verified === 'boolean')
      .map((item) => ({ email: item.email, verified: item.verified }));
  }

  private async request(path: string, init: RequestInit = {}) {
    const retryable = new Set([429, 500, 502, 503, 504]);
    let networkError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const headers = new Headers(this.headers());
        for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
        if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
        if (response.ok) return response;
        if (retryable.has(response.status) && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5_000) : 250 * 2 ** attempt);
          continue;
        }
        const payload = await response.clone().json().catch(() => ({})) as { message?: string };
        const requestId = response.headers.get('x-github-request-id');
        throw new GitHubError(response.status, `${payload.message || `GitHub API 请求失败（${response.status}）`}${requestId ? `，请求标识：${requestId}` : ''}`);
      } catch (error) {
        if (error instanceof GitHubError) throw error;
        networkError = error;
        if (attempt < 2) {
          await wait(250 * 2 ** attempt);
          continue;
        }
      }
    }
    throw new GitHubError(0, `GitHub 网络请求失败：${networkError instanceof Error ? networkError.message : '未知网络错误'}`);
  }

  private async json<T = unknown>(path: string, init: RequestInit = {}) {
    return (await this.request(path, init)).json() as Promise<T>;
  }
}
