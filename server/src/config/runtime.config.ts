import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type GitHubOAuthSettings = {
  clientId: string;
  clientSecret: string;
  authorizationCallbackUrl: string;
  homepageUrl: string;
  sessionCookieDomain?: string;
};

type GitHubOAuthSettingsFile = Record<'development' | 'production', GitHubOAuthSettings>;

export type RuntimeConfig = {
  dataRoot: string;
  serviceDir: string;
  port: number;
  host: string;
  webOrigin: string;
  githubOAuthClientId: string;
  githubOAuthClientSecret: string;
  githubOAuthCallbackUrl: string;
  corsOrigins: string[];
  sessionCookieDomain?: string;
  iosUniversalLink: string;
  iosAppId: string;
};

const githubOAuthConfigPath = () => resolve(process.cwd(), 'config', 'github-oauth.local.json');

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

const sessionCookieDomain = (value: string | undefined, callbackUrl: string, homepageUrl: string, environment: string) => {
  if (!value?.trim()) return undefined;
  const domain = value.trim().replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new Error(`GitHub OAuth ${environment} 配置中的 sessionCookieDomain 必须是根域名，例如 wwenj.com。`);
  }
  const covers = (url: string) => {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  };
  if (!covers(callbackUrl) || !covers(homepageUrl)) {
    throw new Error(`GitHub OAuth ${environment} 的 sessionCookieDomain 必须同时覆盖授权回调地址和首页地址。`);
  }
  return domain;
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
    sessionCookieDomain: sessionCookieDomain(settings.sessionCookieDomain, authorizationCallbackUrl, homepageUrl, environment),
  };
};

const iosUniversalLink = () => {
  const value = process.env.IOS_UNIVERSAL_LINK || 'https://note.wwenj.com/ios/auth/callback';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('IOS_UNIVERSAL_LINK 必须是完整 HTTPS URL。');
  }
  if (url.protocol !== 'https:') throw new Error('IOS_UNIVERSAL_LINK 必须使用 HTTPS。');
  return url.href.replace(/\/$/, '');
};

export const runtimeConfig = (): RuntimeConfig => {
  const oauth = githubOAuthSettings();
  const mobileCallback = iosUniversalLink();
  const corsOriginSetting = process.env.CORS_ORIGINS ?? 'capacitor://localhost';
  const corsOrigins = [...new Set([new URL(oauth.homepageUrl).origin, ...corsOriginSetting.split(',').map((value) => value.trim()).filter(Boolean)])];
  return {
    dataRoot: existsSync('/.dockerenv') ? '/var/lib/note-service' : resolve(process.cwd(), '..', '.runtime'),
    serviceDir: 'note-service',
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '0.0.0.0',
    webOrigin: oauth.homepageUrl,
    githubOAuthClientId: oauth.clientId,
    githubOAuthClientSecret: oauth.clientSecret,
    githubOAuthCallbackUrl: oauth.authorizationCallbackUrl,
    corsOrigins,
    sessionCookieDomain: oauth.sessionCookieDomain,
    iosUniversalLink: mobileCallback,
    iosAppId: process.env.IOS_APP_ID || '6A36R6LTT2.com.wwenj.noteai.capacitor',
  };
};
