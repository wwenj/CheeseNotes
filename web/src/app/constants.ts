import { ApiError } from '../api';
import type { SyncStatus } from '../api';
import type { ClientSettings } from './types';

export const clientSettingsKey = 'mynote.client-settings';
const activeArticleKey = 'mynote.active-article';
const recentArticlesKey = 'mynote.recent-articles';
const recentArticleLimit = 5;
export const defaultClientSettings: ClientSettings = { readerFontSize: 16 };

type StoredArticle = {
  repository: string;
  path: string;
};

type RecentArticle = StoredArticle & {
  openedAt: number;
};

function readStoredArticles() {
  try {
    const value = JSON.parse(localStorage.getItem(recentArticlesKey) || '[]');
    if (!Array.isArray(value)) return [] as RecentArticle[];
    return value.filter((item): item is RecentArticle => (
      typeof item?.repository === 'string'
      && typeof item?.path === 'string'
      && typeof item?.openedAt === 'number'
    ));
  } catch {
    return [] as RecentArticle[];
  }
}

export function activeArticlePath(repository: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem(activeArticleKey) || 'null') as StoredArticle | null;
    return value?.repository === repository && typeof value.path === 'string' ? value.path : null;
  } catch {
    return null;
  }
}

export function recentArticlePaths(repository: string) {
  return readStoredArticles()
    .filter((item) => item.repository === repository)
    .sort((left, right) => right.openedAt - left.openedAt)
    .map((item) => item.path);
}

export function rememberOpenedArticle(repository: string, path: string) {
  const article = { repository, path };
  try {
    sessionStorage.setItem(activeArticleKey, JSON.stringify(article));
  } catch {
    // 读取模式或受限 WebView 不支持 sessionStorage 时，仍可正常打开文档。
  }
  try {
    const recent = readStoredArticles().filter((item) => item.repository !== repository || item.path !== path);
    localStorage.setItem(recentArticlesKey, JSON.stringify([{ ...article, openedAt: Date.now() }, ...recent].slice(0, recentArticleLimit)));
  } catch {
    // 最近访问只是入口辅助，不应影响文档打开。
  }
}

export function forgetOpenedArticle(repository: string, path: string) {
  try {
    const active = activeArticlePath(repository);
    if (active === path) sessionStorage.removeItem(activeArticleKey);
    localStorage.setItem(recentArticlesKey, JSON.stringify(readStoredArticles().filter((item) => item.repository !== repository || item.path !== path)));
  } catch {
    // 删除已完成；本地入口记录清理失败无需阻断后续流程。
  }
}

export const stateText: Record<SyncStatus['state'], string> = {
  unconfigured: '未设置仓库',
  unauthorized: '需要连接 GitHub',
  checking: '正在确认 GitHub',
  pending: '等待同步',
  syncing: '正在同步',
  verified: '已验证同步',
  conflict: '存在冲突',
  failed: '同步失败',
};

export const phaseText: Record<SyncStatus['phase'], string> = {
  idle: '等待开始',
  'checking-repository': '确认仓库权限',
  'checking-remote': '读取远端分支',
  'preparing-workspace': '准备本地工作区',
  cloning: '克隆仓库当前版本',
  'configuring-workspace': '配置本地 Git 工作区',
  'indexing-workspace': '建立文件索引',
  fetching: '读取 GitHub 版本',
  merging: '合并远端修改',
  committing: '提交本地修改',
  pushing: '推送 GitHub',
  verifying: '验证 GitHub ref',
  completed: '同步完成',
  failed: '同步失败',
};

export function isSyncBusy(sync: SyncStatus | null) {
  return sync?.state === 'checking' || sync?.state === 'syncing';
}

export function formatLastSync(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '尚未同步';
  const elapsed = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚同步';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function newNotePath(existingPaths: string[]) {
  const existing = new Set(existingPaths);
  if (!existing.has('未命名.md')) return '未命名.md';
  let index = 2;
  while (existing.has(`未命名 ${index}.md`)) index += 1;
  return `未命名 ${index}.md`;
}

export function formatBytes(value: number) {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function clampReaderFontSize(value: number) {
  return Math.min(20, Math.max(14, Math.round(value)));
}

export function loadClientSettings(): ClientSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(clientSettingsKey) || '{}') as Partial<ClientSettings>;
    return { readerFontSize: clampReaderFontSize(stored.readerFontSize ?? defaultClientSettings.readerFontSize) };
  } catch {
    return { ...defaultClientSettings };
  }
}

export function messageOf(error: unknown) {
  return error instanceof ApiError ? error.message : '操作没有完成，请稍后重试。';
}
