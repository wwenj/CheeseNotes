import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { DevicePublic } from '../auth/device-public.decorator.js';

@DevicePublic()
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  health() {
    return { ok: true };
  }
}
