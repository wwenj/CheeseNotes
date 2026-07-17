import { Controller, Delete, Get, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { runtimeConfig } from '../../config/runtime.config.js';
import { RepositoryService } from '../settings/repository.service.js';
import { SyncService } from '../sync/sync.service.js';
import { currentUser } from './session.guard.js';
import { GitHubAccessDeniedError, OAuthService } from './oauth.service.js';
import { Public } from './public.decorator.js';

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
  startLogin() {
    return this.oauth.beginLogin();
  }

  @Post('github/connect')
  startRepositoryConnection(@Req() request: FastifyRequest) {
    return this.oauth.beginRepositoryConnection(currentUser(request));
  }

  @Public()
  @Get('github/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const base = runtimeConfig().webOrigin;
    if (error || !code || !state) return reply.code(302).redirect(this.redirect(base, 'auth', 'error', error || '授权被取消'));
    try {
      const user = this.oauth.session(request.cookies?.[OAuthService.sessionCookieName]);
      const result = await this.oauth.finishWeb(code, state, user?.id);
      if (result.purpose === 'login') {
        reply.setCookie(OAuthService.sessionCookieName, result.sessionToken, this.sessionCookieOptions());
        return reply.code(302).redirect(this.redirect(base, 'auth', 'success'));
      }
      this.sync.triggerInitialize();
      return reply.code(302).redirect(this.redirect(base, 'github', 'connected'));
    } catch (reason) {
      if (reason instanceof GitHubAccessDeniedError) return reply.code(302).redirect(this.redirect(base, 'auth', 'forbidden'));
      const message = reason instanceof Error ? reason.message : 'GitHub 授权失败';
      this.logger.warn(`GitHub OAuth callback failed: ${message}`);
      return reply.code(302).redirect(this.redirect(base, 'auth', 'error', message));
    }
  }

  @Public()
  @Get('session')
  session(@Req() request: FastifyRequest) {
    const user = this.oauth.session(request.cookies?.[OAuthService.sessionCookieName]);
    return { authenticated: Boolean(user), user };
  }

  @Post('logout')
  logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.logout(request.cookies?.[OAuthService.sessionCookieName]);
    reply.clearCookie(OAuthService.sessionCookieName, this.sessionCookieOptions());
    return reply.send({ ok: true });
  }

  @Get('github/status')
  status(@Req() request: FastifyRequest) {
    return this.oauth.connectionStatus(currentUser(request), this.repository.get());
  }

  @Delete('github')
  async disconnect(@Req() request: FastifyRequest) {
    currentUser(request);
    await this.sync.clearWorkspace();
    this.repository.clear();
    this.oauth.disconnect();
    return this.oauth.connectionStatus(currentUser(request), this.repository.get());
  }

  private redirect(base: string, key: 'auth' | 'github', value: string, reason?: string) {
    const url = new URL(base);
    url.searchParams.set(key, value);
    if (reason) url.searchParams.set('reason', reason);
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
