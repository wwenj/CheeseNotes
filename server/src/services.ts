/**
 * 兼容旧的聚合导入路径；业务实现已按模块拆分。
 */
export { DatabaseService } from './modules/database/database.service.js';
export { GitProcessService } from './modules/storage/git-process.service.js';
export { RepositoryWorkspaceService } from './modules/storage/repository-workspace.service.js';
export { PathPolicy } from './modules/storage/path-policy.service.js';
export { RepositoryService } from './modules/settings/repository.service.js';
export { GitHubService } from './modules/github/github.service.js';
export { OAuthService } from './modules/auth/oauth.service.js';
export { SyncService } from './modules/sync/sync.service.js';
export { NoteService } from './modules/notes/note.service.js';
