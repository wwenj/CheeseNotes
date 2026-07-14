import { request } from './http';

export type GitHubAuth = { authenticated: boolean; login: string | null; repository: string | null };
export type GitHubRepository = { fullName: string; private: boolean; branch: string; updatedAt: string };

export const githubApi = {
  auth: () => request<GitHubAuth>('auth/github/status'),
  startWebAuthorization: () => request<{ url: string }>('auth/github/login', { method: 'POST' }),
  disconnect: () => request<GitHubAuth>('auth/github', { method: 'DELETE' }),
  repositories: (page = 1) => request<GitHubRepository[]>(`github/repositories?page=${page}`),
};
