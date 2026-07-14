import { Module } from '@nestjs/common';
import { GitHubController } from './github.controller.js';
import { GitHubService } from './github.service.js';

@Module({ controllers: [GitHubController], providers: [GitHubService], exports: [GitHubService] })
export class GitHubModule {}
