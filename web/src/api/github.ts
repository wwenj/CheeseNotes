import { Browser } from '@capacitor/browser';
import { request } from './http';
import { isNativeIOS } from './platform';

export type GitHubConnection = { connected: boolean; login: string | null; repository: string | null };
export type GitHubRepository = { fullName: string; private: boolean; branch: string; updatedAt: string };

export const githubApi = {
  connection: () => request<GitHubConnection>('auth/github/status'),
  openRepositoryAuthorization: async () => {
    const authorization = await request<{ url: string }>('auth/github/connect', { method: 'POST' });
    if (isNativeIOS()) {
      await Browser.open({ url: authorization.url, presentationStyle: 'fullscreen' });
      return;
    }
    window.location.assign(authorization.url);
  },
  disconnect: () => request<GitHubConnection>('auth/github', { method: 'DELETE' }),
  repositories: (page = 1) => request<GitHubRepository[]>(`github/repositories?page=${page}`),
};
