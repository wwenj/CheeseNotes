import { Body, Controller, Get, HttpCode, Inject, Put } from '@nestjs/common';
import { IsString } from 'class-validator';
import { RepositoryService } from './repository.service.js';
import { SyncService } from '../sync/sync.service.js';

class RepositoryDto {
  @IsString()
  repository!: string;
}

@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(RepositoryService) private readonly repository: RepositoryService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  @Get('repository')
  getRepository() {
    return { repository: this.repository.get(), branch: this.repository.branch() || null };
  }

  @Put('repository')
  @HttpCode(202)
  setRepository(@Body() dto: RepositoryDto) {
    const repository = this.repository.set(dto.repository);
    return { repository, sync: this.sync.triggerInitialize() };
  }
}
