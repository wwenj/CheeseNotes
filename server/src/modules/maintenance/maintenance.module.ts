import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

@Module({ imports: [SyncModule], controllers: [MaintenanceController], providers: [MaintenanceService] })
export class MaintenanceModule {}
