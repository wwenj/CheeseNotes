/**
 * 兼容旧的聚合导入路径；新代码应从 modules 下的具体 controller 文件导入。
 */
export { AuthController as GitHubAuthController } from './modules/auth/auth.controller.js';
export { GitHubController } from './modules/github/github.controller.js';
export { HealthController } from './modules/health/health.controller.js';
export { MaintenanceController } from './modules/maintenance/maintenance.controller.js';
export { NotesController as NoteController } from './modules/notes/notes.controller.js';
export { SettingsController } from './modules/settings/settings.controller.js';
export { SyncController } from './modules/sync/sync.controller.js';
