import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { OAuthService, type SessionUser } from './oauth.service.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';

export type AuthenticatedRequest = FastifyRequest & { noteaiUser?: SessionUser };

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
    const user = this.oauth.session(request.cookies?.[OAuthService.sessionCookieName]);
    if (!user) throw new UnauthorizedException('请先登录');
    request.noteaiUser = user;
    return true;
  }
}
