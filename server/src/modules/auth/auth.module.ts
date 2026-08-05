import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GitHubModule } from '../github/github.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { AuthController } from './auth.controller.js';
import { AccessController } from './access.controller.js';
import { AUTHENTICATOR_SECRET_VALUE, AuthenticatorService } from './authenticator.service.js';
import { runtimeConfig } from '../../config/runtime.config.js';
import { DeviceGuard } from './device.guard.js';
import { OAuthService } from './oauth.service.js';

@Module({
  imports: [GitHubModule, SettingsModule, SyncModule],
  controllers: [AuthController, AccessController],
  providers: [
    OAuthService,
    { provide: AUTHENTICATOR_SECRET_VALUE, useFactory: () => runtimeConfig().authenticatorSecret },
    AuthenticatorService,
    DeviceGuard,
    { provide: APP_GUARD, useExisting: DeviceGuard },
  ],
})
export class AuthModule {}
