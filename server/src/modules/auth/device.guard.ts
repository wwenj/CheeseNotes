import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthenticatorService } from './authenticator.service.js';
import { IS_DEVICE_PUBLIC_ROUTE } from './device-public.decorator.js';

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthenticatorService) private readonly authenticator: AuthenticatorService,
  ) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_DEVICE_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const value = request.headers['x-device-token'];
    const token = Array.isArray(value) ? value[0] : value;
    if (!this.authenticator.isTrustedDevice(token)) {
      throw new UnauthorizedException({ code: 'DEVICE_AUTH_REQUIRED', message: '需要验证 Authenticator' });
    }
    return true;
  }
}
