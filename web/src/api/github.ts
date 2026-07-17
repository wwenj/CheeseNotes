import { request } from './http';
import type { AuthClient } from './auth';

export type GitHubConnection = { connected: boolean; login: string | null; repository: string | null };
export type GitHubRepository = { fullName: string; private: boolean; branch: string; updatedAt: string };

export const githubApi = {
  connection: () => request<GitHubConnection>('auth/github/status'),
  startRepositoryAuthorization: (client: AuthClient = 'web') => request<{ url: string }>('auth/github/connect', { method: 'POST', body: JSON.stringify({ client }) }),
  disconnect: () => request<GitHubConnection>('auth/github', { method: 'DELETE' }),
  repositories: (page = 1) => request<GitHubRepository[]>(`github/repositories?page=${page}`),
};
