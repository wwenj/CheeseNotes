import { Module } from '@nestjs/common';
import { RepositoryService } from './repository.service.js';

@Module({ providers: [RepositoryService], exports: [RepositoryService] })
export class SettingsModule {}
