import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { GitHubModule } from './modules/github/github.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { NotesModule } from './modules/notes/notes.module.js';
import { SettingsApiModule } from './modules/settings/settings-api.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { SyncModule } from './modules/sync/sync.module.js';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    SettingsApiModule,
    GitHubModule,
    SyncModule,
    NotesModule,
    AuthModule,
    HealthModule,
    MaintenanceModule,
  ],
})
export class AppModule {}
