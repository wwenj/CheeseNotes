import { ApiError } from '../api';
import type { SyncStatus } from '../api';
import type { ClientSettings } from './types';

export const clientSettingsKey = 'mynote.client-settings';
export const lastArticleKey = 'mynote.last-open-article';
export const defaultClientSettings: ClientSettings = { readerFontSize: 16 };

export const stateText: Record<SyncStatus['state'], string> = {
  unconfigured: '未设置仓库',
  unauthorized: '需要连接 GitHub',
  initializing: '正在初始化仓库',
  pending: '等待同步',
  syncing: '正在同步',
  synced: '已同步',
  conflict: '存在冲突',
  failed: '同步失败',
};

export const phaseText: Record<SyncStatus['phase'], string> = {
  idle: '等待开始',
  'validating-auth': '校验 GitHub 授权',
  'validating-repository': '校验仓库权限',
  'loading-tree': '读取仓库文件树',
  downloading: '下载笔记文本',
  activating: '激活本地缓存',
  uploading: '提交本地修改',
  refreshing: '刷新远端修改',
  completed: '同步完成',
  failed: '同步失败',
};

export function isSyncBusy(sync: SyncStatus | null) {
  return sync?.state === 'initializing' || sync?.state === 'syncing';
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

export function newNotePath() {
  return `收件箱/${new Date().toISOString().slice(0, 10)}.md`;
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
