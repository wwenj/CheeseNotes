import { Controller, Get, Inject, Query } from '@nestjs/common';
import { GitHubService } from './github.service.js';

@Controller('github')
export class GitHubController {
  constructor(@Inject(GitHubService) private readonly github: GitHubService) {}

  @Get('repositories')
  repositories(@Query('page') page = '1') {
    return this.github.repositories(Number(page) || 1);
  }
}
