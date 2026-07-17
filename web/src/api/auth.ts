import { request } from './http';

export type CurrentUser = {
  id: string;
  githubId: string;
  login: string;
  email: string;
  avatarUrl: string | null;
};

export type AuthSession = { authenticated: boolean; user: CurrentUser | null };

export const authApi = {
  session: () => request<AuthSession>('auth/session'),
  startGitHubLogin: () => request<{ url: string }>('auth/github/login', { method: 'POST' }),
  logout: () => request<{ ok: boolean }>('auth/logout', { method: 'POST' }),
};
