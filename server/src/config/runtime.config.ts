import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type GitTransport = 'https' | 'ssh';

type GitHubOAuthSettings = {
  clientId: string;
  clientSecret: string;
  gitTransport: GitTransport;
};

type EnvironmentSettings = {
  webOrigin: string;
  serviceOrigin: string;
  corsOrigins: string[];
  dataRoot: string;
  host: string;
  port: number;
  authenticatorSecret: string;
  githubOAuth: GitHubOAuthSettings;
};

type RuntimeSettingsFile = Record<'development' | 'production', EnvironmentSettings>;

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
  authenticatorSecret: string;
};

const runtimeConfigPath = () => resolve(process.cwd(), 'config', 'runtime.local.json');

const gitTransport = (settings: GitHubOAuthSettings, environment: string): GitTransport => {
  const value = settings.gitTransport ?? 'https';
  if (value === 'https' || value === 'ssh') return value;
  throw new Error(`GitHub OAuth ${environment} 配置中的 gitTransport 只能是 https 或 ssh。`);
};

const requiredSetting = (settings: Record<string, unknown>, key: string, environment: string) => {
  const value = settings[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`GitHub OAuth ${environment} 配置缺少 ${key}。`);
  return value.trim();
};

const requiredUrl = (value: unknown, name: string, environment: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${environment} 配置缺少 ${name}。`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${environment} 配置中的 ${name} 必须是完整 URL。`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${environment} 配置中的 ${name} 必须使用 http 或 https。`);
  return url.href.replace(/\/$/, '');
};

const runtimeSettings = (): EnvironmentSettings => {
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const path = runtimeConfigPath();
  if (!existsSync(path)) throw new Error(`缺少服务端本地配置文件：${path}。请从 config/runtime.example.json 复制为 config/runtime.local.json 后填写。`);

  let file: RuntimeSettingsFile;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as RuntimeSettingsFile;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '未知错误';
    throw new Error(`无法读取服务端本地配置文件：${message}`);
  }

  const settings = file[environment];
  if (!settings) throw new Error(`服务端本地配置缺少 ${environment} 环境。`);
  return settings;
};

export const runtimeConfig = (): RuntimeConfig => {
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const settings = runtimeSettings();
  const oauth = settings.githubOAuth;
  if (!oauth || typeof oauth !== 'object') throw new Error(`${environment} 配置缺少 githubOAuth。`);
  const webOrigin = requiredUrl(settings.webOrigin, 'webOrigin', environment);
  const serviceOrigin = requiredUrl(settings.serviceOrigin, 'serviceOrigin', environment);
  if (!Array.isArray(settings.corsOrigins) || settings.corsOrigins.some((origin) => typeof origin !== 'string' || !origin.trim())) {
    throw new Error(`${environment} 配置中的 corsOrigins 必须是非空字符串数组。`);
  }
  if (typeof settings.dataRoot !== 'string' || !settings.dataRoot.trim()) throw new Error(`${environment} 配置缺少 dataRoot。`);
  if (typeof settings.host !== 'string' || !settings.host.trim()) throw new Error(`${environment} 配置缺少 host。`);
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new Error(`${environment} 配置中的 port 必须是 1 到 65535 的整数。`);
  const authenticatorSecret = requiredSetting(settings, 'authenticatorSecret', environment);
  const corsOrigins = [...new Set([new URL(webOrigin).origin, ...settings.corsOrigins.map((value) => value.trim())])];
  return {
    dataRoot: resolve(process.cwd(), settings.dataRoot),
    gitTransport: gitTransport(oauth, environment),
    serviceDir: 'note-service',
    port: settings.port,
    host: settings.host.trim(),
    webOrigin,
    githubOAuthClientId: requiredSetting(oauth, 'clientId', environment),
    githubOAuthClientSecret: requiredSetting(oauth, 'clientSecret', environment),
    githubOAuthCallbackUrl: `${serviceOrigin}/api/auth/github/callback`,
    corsOrigins,
    authenticatorSecret,
  };
};
