import { Module } from '@nestjs/common';
import { GitProcessService } from './git-process.service.js';
import { PathPolicy } from './path-policy.service.js';
import { RepositoryWorkspaceService } from './repository-workspace.service.js';

@Module({
  providers: [PathPolicy, GitProcessService, RepositoryWorkspaceService],
  exports: [PathPolicy, GitProcessService, RepositoryWorkspaceService],
})
export class StorageModule {}
