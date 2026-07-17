import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { OAuthService, type SessionUser } from './oauth.service.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';

export type AuthenticatedRequest = FastifyRequest & { noteaiUser?: SessionUser; noteaiSessionToken?: string };

export const sessionTokenFromRequest = (request: FastifyRequest) => {
  const authorization = request.headers?.authorization;
  const bearer = typeof authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() : undefined;
  return bearer || request.cookies?.[OAuthService.sessionCookieName];
};

export const currentUser = (request: FastifyRequest) => {
  const user = (request as AuthenticatedRequest).noteaiUser;
  if (!user) throw new UnauthorizedException('请先登录');
  return user;
};

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(OAuthService) private readonly oauth: OAuthService,
  ) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = sessionTokenFromRequest(request);
    const user = this.oauth.session(token);
    if (!user) throw new UnauthorizedException('请先登录');
    request.noteaiUser = user;
    request.noteaiSessionToken = token;
    return true;
  }
}
