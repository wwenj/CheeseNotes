import { Controller, Get, HttpCode, Param, Post, Body, Inject } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { ResolveConflictDto } from './contracts/sync.dto.js';
import { SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get('status')
  status() {
    return this.sync.status();
  }

  @Post()
  @HttpCode(202)
  run() {
    return this.sync.triggerSync();
  }

  @Get('conflicts')
  conflicts() {
    return this.database.db.prepare('SELECT id,path,remote_commit,created_at FROM conflicts ORDER BY created_at DESC').all();
  }

  @Get('conflicts/:id')
  conflict(@Param('id') id: string) {
    return this.database.db.prepare('SELECT * FROM conflicts WHERE id=?').get(id);
  }

  @Post('conflicts/:id/resolve')
  @HttpCode(202)
  resolve(@Param('id') id: string, @Body() dto: ResolveConflictDto) {
    return this.sync.resolveConflict(id, dto);
  }
}
