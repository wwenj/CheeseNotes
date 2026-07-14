import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsModule } from './settings.module.js';

@Module({ imports: [SettingsModule, SyncModule], controllers: [SettingsController] })
export class SettingsApiModule {}
