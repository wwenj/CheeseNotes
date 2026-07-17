import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { AuthenticatorService } from './authenticator.service.js';
import { DevicePublic } from './device-public.decorator.js';

class VerifyAuthenticatorDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: '请输入 6 位 Authenticator 验证码' })
  code!: string;
}

const deviceTokenFromRequest = (request: FastifyRequest) => {
  const token = request.headers['x-device-token'];
  return Array.isArray(token) ? token[0] : token;
};

@DevicePublic()
@Controller('access')
export class AccessController {
  constructor(@Inject(AuthenticatorService) private readonly authenticator: AuthenticatorService) {}

  @Get('status')
  status(@Req() request: FastifyRequest) {
    return { authorized: this.authenticator.isTrustedDevice(deviceTokenFromRequest(request)) };
  }

  @Post('verify')
  verify(@Body() body: VerifyAuthenticatorDto, @Req() request: FastifyRequest) {
    const clientKey = request.ip || request.socket.remoteAddress || 'unknown';
    return { authorized: true, token: this.authenticator.verifyCode(body.code, clientKey) };
  }
}
