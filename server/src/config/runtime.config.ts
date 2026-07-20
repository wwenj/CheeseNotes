import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type GitTransport = 'https' | 'ssh';

type GitHubOAuthSettings = {
  clientId: string;
  clientSecret: string;
  authorizationCallbackUrl: string;
  homepageUrl: string;
  gitTransport?: GitTransport;
};

type GitHubOAuthSettingsFile = Record<'development' | 'production', GitHubOAuthSettings>;

export type RuntimeConfig = {
  dataRoot: string;
  gitTransport: GitTransport;
  serviceDir: string;
  port: number;
  host: string;
  webOrigin: string;
  githubOAuthClientId: string;
  githubOAuthClientSecret: string;
  githubOAuthCallbackUrl: string;
  corsOrigins: string[];
};

const githubOAuthConfigPath = () => resolve(process.cwd(), 'config', 'github-oauth.local.json');

const gitTransport = (settings: GitHubOAuthSettings, environment: string): GitTransport => {
  const value = settings.gitTransport ?? 'https';
  if (value === 'https' || value === 'ssh') return value;
  throw new Error(`GitHub OAuth ${environment} 配置中的 gitTransport 只能是 https 或 ssh。`);
};

const requiredSetting = (settings: GitHubOAuthSettings, key: keyof GitHubOAuthSettings, environment: string) => {
  const value = settings[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`GitHub OAuth ${environment} 配置缺少 ${key}。`);
  return value.trim();
};

const httpUrl = (value: string, key: keyof GitHubOAuthSettings, environment: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`GitHub OAuth ${environment} 配置中的 ${key} 必须是完整 URL。`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`GitHub OAuth ${environment} 配置中的 ${key} 必须使用 http 或 https。`);
  return url.href.replace(/\/$/, '');
};

const githubOAuthSettings = (): GitHubOAuthSettings => {
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const path = githubOAuthConfigPath();
  if (!existsSync(path)) throw new Error(`缺少 GitHub OAuth 本地配置文件：${path}`);

  let file: GitHubOAuthSettingsFile;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as GitHubOAuthSettingsFile;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '未知错误';
    throw new Error(`无法读取 GitHub OAuth 本地配置文件：${message}`);
  }

  const settings = file[environment];
  if (!settings) throw new Error(`GitHub OAuth 本地配置缺少 ${environment} 环境。`);
  const authorizationCallbackUrl = httpUrl(requiredSetting(settings, 'authorizationCallbackUrl', environment), 'authorizationCallbackUrl', environment);
  const homepageUrl = httpUrl(requiredSetting(settings, 'homepageUrl', environment), 'homepageUrl', environment);
  return {
    clientId: requiredSetting(settings, 'clientId', environment),
    clientSecret: requiredSetting(settings, 'clientSecret', environment),
    authorizationCallbackUrl,
    homepageUrl,
    gitTransport: gitTransport(settings, environment),
  };
};

export const runtimeConfig = (): RuntimeConfig => {
  const oauth = githubOAuthSettings();
  const corsOriginSetting = process.env.CORS_ORIGINS ?? 'capacitor://localhost';
  const corsOrigins = [...new Set([new URL(oauth.homepageUrl).origin, ...corsOriginSetting.split(',').map((value) => value.trim()).filter(Boolean)])];
  return {
    dataRoot: process.env.NOTEAI_DATA_ROOT
      ? resolve(process.env.NOTEAI_DATA_ROOT)
      : existsSync('/.dockerenv') ? '/var/lib/note-service' : resolve(process.cwd(), '..', '.runtime'),
    gitTransport: oauth.gitTransport ?? 'https',
    serviceDir: 'note-service',
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '0.0.0.0',
    webOrigin: oauth.homepageUrl,
    githubOAuthClientId: oauth.clientId,
    githubOAuthClientSecret: oauth.clientSecret,
    githubOAuthCallbackUrl: oauth.authorizationCallbackUrl,
    corsOrigins,
  };
};
