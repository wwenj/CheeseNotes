import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  health() {
    return { ok: true };
  }
}
