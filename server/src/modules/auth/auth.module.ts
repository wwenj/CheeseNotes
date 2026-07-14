import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { AuthController } from './auth.controller.js';
import { OAuthService } from './oauth.service.js';

@Module({ imports: [GitHubModule, SettingsModule, SyncModule], controllers: [AuthController], providers: [OAuthService] })
export class AuthModule {}
