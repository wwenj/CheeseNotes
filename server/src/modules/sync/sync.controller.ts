import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { SaveConflictDecisionDto } from './contracts/sync.dto.js';
import { SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(
    @Inject(SyncService) private readonly sync: SyncService,
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
  conflicts(@Query('cursor') cursor?: string, @Query('limit') limit?: string, @Query('q') query?: string, @Query('review') review?: string) {
    return this.sync.conflicts({ cursor, limit, query, review });
  }

  @Get('conflicts/:id')
  conflict(@Param('id') id: string) {
    return this.sync.conflictDetail(id);
  }

  @Put('conflicts/decisions')
  decisions(@Body() dto: SaveConflictDecisionDto) {
    return this.sync.saveAllConflictDecisions(dto);
  }

  @Put('conflicts/:id/decision')
  decision(@Param('id') id: string, @Body() dto: SaveConflictDecisionDto) {
    return this.sync.saveConflictDecision(id, dto);
  }

  @Post('conflicts/apply-decisions')
  @HttpCode(202)
  applyDecisions() {
    return this.sync.applyConflictDecisions();
  }
}
