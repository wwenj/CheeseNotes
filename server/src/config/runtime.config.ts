import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type RuntimeConfig = {
  dataRoot: string;
  serviceDir: string;
  port: number;
  host: string;
  webOrigin: string;
  githubOAuthCallbackUrl: string;
};

export const runtimeConfig = (): RuntimeConfig => ({
  dataRoot: existsSync('/.dockerenv') ? '/var/lib/note-service' : resolve(process.cwd(), '..', '.runtime'),
  serviceDir: 'note-service',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  githubOAuthCallbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL || 'http://127.0.0.1:3000/api/auth/github/callback',
});
