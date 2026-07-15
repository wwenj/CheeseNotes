import { Controller, Delete, Get, Inject, Logger, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { runtimeConfig } from '../../config/runtime.config.js';
import { RepositoryService } from '../settings/repository.service.js';
import { SyncService } from '../sync/sync.service.js';
import { OAuthService } from './oauth.service.js';

@Controller('auth/github')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(OAuthService) private readonly oauth: OAuthService,
    @Inject(RepositoryService) private readonly repository: RepositoryService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  @Post('login')
  startWeb() {
    return this.oauth.beginWeb();
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string | undefined, @Res() reply: FastifyReply) {
    const base = runtimeConfig().webOrigin;
    if (error || !code || !state) return reply.code(302).redirect(`${base}/?github=error&reason=${encodeURIComponent(error || '授权被取消')}`);
    try {
      await this.oauth.finishWeb(code, state);
      this.sync.triggerInitialize();
      return reply.code(302).redirect(`${base}/?github=connected`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'GitHub 授权失败';
      this.logger.warn(`GitHub OAuth callback failed: ${message}`);
      return reply.code(302).redirect(`${base}/?github=error&reason=${encodeURIComponent(message)}`);
    }
  }

  @Get('status')
  status() {
    return this.oauth.status(this.repository.get());
  }

  @Delete()
  async disconnect() {
    await this.sync.clearWorkspace();
    this.repository.clear();
    this.oauth.disconnect();
    return this.oauth.status(this.repository.get());
  }
}
