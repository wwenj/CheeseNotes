import { Body, Controller, Delete, Get, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { runtimeConfig } from '../../config/runtime.config.js';
import { RepositoryService } from '../settings/repository.service.js';
import { SyncService } from '../sync/sync.service.js';
import { sessionTokenFromRequest } from './session.guard.js';
import { GitHubAccessDeniedError, OAuthService, type OAuthClient } from './oauth.service.js';
import { Public } from './public.decorator.js';
import { DevicePublic } from './device-public.decorator.js';

class OAuthClientDto {
  @IsOptional()
  @IsIn(['web', 'ios'])
  client?: OAuthClient;
}

class MobileHandoffDto {
  @IsString()
  handoff!: string;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(OAuthService) private readonly oauth: OAuthService,
    @Inject(RepositoryService) private readonly repository: RepositoryService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  @Public()
  @Post('github/login')
  startLogin(@Body() body?: OAuthClientDto) {
    return this.oauth.beginLogin(body?.client ?? 'web');
  }

  @Public()
  @Post('github/connect')
  startRepositoryConnection(@Body() body?: OAuthClientDto) {
    return this.oauth.beginRepositoryConnection(body?.client ?? 'web');
  }

  @Public()
  @DevicePublic()
  @Get('github/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const client = this.oauth.clientForState(state);
    const purpose = this.oauth.purposeForState(state);
    const base = this.callbackBase(client);
    const callbackKey = purpose === 'repository' ? 'github' : 'auth';
    if (error || !code || !state) return reply.code(302).redirect(this.redirect(base, callbackKey, 'error', error || '授权被取消'));
    try {
      const result = await this.oauth.finishWeb(code, state);
      if (result.purpose === 'login') {
        if (result.client === 'ios') {
          return reply.code(302).redirect(this.redirect(base, 'auth', 'success', undefined, this.oauth.createMobileHandoff(result.user.id)));
        }
        if (!result.sessionToken) throw new Error('Web 登录未能建立会话');
        reply.setCookie(OAuthService.sessionCookieName, result.sessionToken, this.sessionCookieOptions());
        return reply.code(302).redirect(this.redirect(base, 'auth', 'success'));
      }
      this.sync.triggerInitialize();
      return reply.code(302).redirect(this.redirect(base, 'github', 'connected'));
    } catch (reason) {
      if (reason instanceof GitHubAccessDeniedError) return reply.code(302).redirect(this.redirect(base, 'auth', 'forbidden'));
      const message = reason instanceof Error ? reason.message : 'GitHub 授权失败';
      this.logger.warn(`GitHub OAuth callback failed: ${message}`);
      return reply.code(302).redirect(this.redirect(base, callbackKey, 'error', message));
    }
  }

  @Public()
  @Get('session')
  session(@Req() request: FastifyRequest) {
    const user = this.oauth.session(sessionTokenFromRequest(request));
    return { authenticated: Boolean(user), user };
  }

  @Public()
  @Post('mobile/session/exchange')
  exchangeMobileSession(@Body() body: MobileHandoffDto) {
    return this.oauth.exchangeMobileHandoff(body.handoff);
  }

  @Post('logout')
  logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.logout(sessionTokenFromRequest(request));
    reply.clearCookie(OAuthService.sessionCookieName, this.sessionCookieOptions());
    return reply.send({ ok: true });
  }

  @Public()
  @Get('github/status')
  status() {
    return this.oauth.connectionStatus(this.repository.get());
  }

  @Public()
  @Delete('github')
  async disconnect() {
    await this.sync.clearWorkspace();
    this.repository.clear();
    this.oauth.disconnect();
    return this.oauth.connectionStatus(this.repository.get());
  }

  private callbackBase(client: OAuthClient) {
    const config = runtimeConfig();
    return client === 'ios' ? config.iosUniversalLink : config.webOrigin;
  }

  private redirect(base: string, key: 'auth' | 'github', value: string, reason?: string, handoff?: string) {
    const url = new URL(base);
    url.searchParams.set(key, value);
    if (reason) url.searchParams.set('reason', reason);
    if (handoff) url.searchParams.set('handoff', handoff);
    return url.toString();
  }

  private sessionCookieOptions() {
    const config = runtimeConfig();
    return {
      path: '/',
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: new URL(config.webOrigin).protocol === 'https:',
      maxAge: 30 * 24 * 60 * 60,
      ...(config.sessionCookieDomain ? { domain: config.sessionCookieDomain } : {}),
    };
  }
}
