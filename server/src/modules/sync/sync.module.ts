import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({ imports: [GitHubModule, SettingsModule, StorageModule], controllers: [SyncController], providers: [SyncService], exports: [SyncService] })
export class SyncModule {}
