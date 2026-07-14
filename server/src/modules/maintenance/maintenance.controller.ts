import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';

@Controller('maintenance')
export class MaintenanceController {
  constructor(@Inject(MaintenanceService) private readonly maintenance: MaintenanceService) {}

  @Post('reset/prepare')
  prepare() {
    return this.maintenance.prepare();
  }

  @Post('reset/execute')
  @HttpCode(202)
  execute(@Body() body: { confirmationId: string }) {
    return this.maintenance.execute(body.confirmationId);
  }
}
