import { Controller, Delete, Get, Inject, Logger, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { runtimeConfig } from '../../config/runtime.config.js';
import { RepositoryService } from '../settings/repository.service.js';
import { SyncService } from '../sync/sync.service.js';
import { DevicePublic } from './device-public.decorator.js';
import { OAuthService } from './oauth.service.js';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(OAuthService) private readonly oauth: OAuthService,
    @Inject(RepositoryService) private readonly repository: RepositoryService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  @Post('github/connect')
  startRepositoryConnection() {
    return this.oauth.beginRepositoryConnection();
  }

  @DevicePublic()
  @Get('github/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const base = runtimeConfig().webOrigin;
    if (error || !code || !state) return reply.code(302).redirect(this.redirect(base, 'error', error || '授权被取消'));
    try {
      await this.oauth.finishRepositoryConnection(code, state);
      return reply.code(302).redirect(this.redirect(base, 'connected'));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'GitHub 授权失败';
      this.logger.warn(`GitHub OAuth callback failed: ${message}`);
      return reply.code(302).redirect(this.redirect(base, 'error', message));
    }
  }

  @Get('github/status')
  status() {
    return this.oauth.connectionStatus(this.repository.get());
  }

  @Delete('github')
  async disconnect() {
    await this.sync.clearWorkspace();
    this.repository.clear();
    this.oauth.disconnect();
    return this.oauth.connectionStatus(this.repository.get());
  }

  private redirect(base: string, value: string, reason?: string) {
    const url = new URL(base);
    url.searchParams.set('github', value);
    if (reason) url.searchParams.set('reason', reason);
    return url.toString();
  }
}
