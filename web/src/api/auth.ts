import { request } from './http';

export type CurrentUser = {
  id: string;
  githubId: string;
  login: string;
  email: string;
  avatarUrl: string | null;
};

export type AuthSession = { authenticated: boolean; user: CurrentUser | null };
export type AuthClient = 'web' | 'ios';
export type MobileSession = { token: string; expiresAt: string; user: CurrentUser };

export const authApi = {
  session: () => request<AuthSession>('auth/session'),
  startGitHubLogin: (client: AuthClient = 'web') => request<{ url: string }>('auth/github/login', { method: 'POST', body: JSON.stringify({ client }) }),
  exchangeMobileSession: (handoff: string) => request<MobileSession>('auth/mobile/session/exchange', { method: 'POST', body: JSON.stringify({ handoff }) }),
  logout: () => request<{ ok: boolean }>('auth/logout', { method: 'POST' }),
};
