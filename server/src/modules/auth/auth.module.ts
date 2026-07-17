import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GitHubModule } from '../github/github.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { AuthController } from './auth.controller.js';
import { OAuthService } from './oauth.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [GitHubModule, SettingsModule, SyncModule],
  controllers: [AuthController],
  providers: [OAuthService, SessionGuard, { provide: APP_GUARD, useExisting: SessionGuard }],
})
export class AuthModule {}
