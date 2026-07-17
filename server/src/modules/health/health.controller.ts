import { Controller, Get } from '@nestjs/common';
import { DevicePublic } from '../auth/device-public.decorator.js';

@DevicePublic()
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}
