import { request } from './http';
import type { SyncStatus } from './sync';

export const settingsApi = {
  repository: () => request<{ repository: string; branch: string | null }>('settings/repository'),
  saveRepository: (repository: string) => request<{ repository: string; sync: SyncStatus }>('settings/repository', { method: 'PUT', body: JSON.stringify({ repository }) }),
};
