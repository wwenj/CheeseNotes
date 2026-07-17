import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { OAuthService } from './oauth.service.js';

export const sessionTokenFromRequest = (request: FastifyRequest) => {
  const authorization = request.headers?.authorization;
  const bearer = typeof authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() : undefined;
  return bearer || request.cookies?.[OAuthService.sessionCookieName];
};

@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(_context: ExecutionContext) {
    // 登录和白名单暂缓，当前工作区不做请求级权限校验。
    return true;
  }
}
