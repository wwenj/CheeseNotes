# Server architecture

当前服务采用“模块化单体 + Controller / Service / Store / Contract”结构。接口路径和成功响应保持现有 Web、iOS 客户端兼容，内部实现按领域重新组装。

## 目录分层

```text
src/
├── main.ts                         # Fastify/Nest bootstrap、全局前缀和校验管道
├── app.module.ts                   # 只负责模块组装
├── config/                         # 端口、数据根目录、OAuth 回调等运行时配置
├── common/                         # hash、时间、文件类型、SQLite settings 小工具
└── modules/
    ├── database/                   # SQLite 连接、schema 初始化和 settings
    ├── storage/                    # 路径安全策略和笔记文件存储
    ├── github/                     # GitHub API client 和仓库列表接口
    ├── auth/                       # GitHub OAuth、登录回调和认证状态
    ├── settings/                   # 当前仓库及分支设置
    │   └── settings-api.module.ts  # 设置 HTTP API 组装层
    ├── notes/                      # 笔记读取、编辑、渲染、搜索和资源文件
    ├── sync/                       # 初始化、增量同步、任务状态和冲突处理
    ├── maintenance/                # 重置确认流程
    └── health/                     # 健康检查
```

每个业务模块的约定：

- `*.module.ts`：声明模块边界和导出能力。
- `*.controller.ts`：只处理 HTTP 路由、参数和响应适配。
- `*.service.ts`：承载业务流程和领域规则。
- `contracts/`：DTO、状态类型和外部协议类型。
- `storage/`、`database/`：隔离文件系统和 SQLite 细节。
- 所有构造函数依赖均显式标注 `@Inject(...)`，保证 `tsx` 开发启动不依赖 TypeScript 的设计类型元数据。

## 依赖方向

```text
Auth ───────────────┐
Notes ──────────────┼──> Sync ───> Settings
Maintenance ───────┘       ├─────> GitHub
                            ├─────> Storage
                            └─────> Database
SettingsApi ────────────────> Sync
Notes ───────────────────────> Storage / Database
```

同步模块不再依赖 `NoteService`，而是直接通过 `FileStoreService` 处理远端激活和冲突文件。这样避免“笔记保存依赖同步、同步又依赖笔记服务”的业务循环；笔记服务只通过 `SyncService.record()` 记录待同步变更。

## 接口契约

全局前缀仍为 `/api`，成功响应仍为原始 JSON，不新增响应 envelope，以兼容现有客户端。

| 模块 | 接口 |
| --- | --- |
| Health | `GET /api/health` |
| Notes | `GET /api/tree`、`GET /api/notes/content`、`GET /api/notes/render`、`GET /api/files`、`GET /api/search` |
| Notes | `POST /api/notes`、`PUT /api/notes`、`DELETE /api/notes` |
| Sync | `GET /api/sync/status`、`POST /api/sync` |
| Sync | `GET /api/sync/conflicts`、`GET /api/sync/conflicts/:id`、`POST /api/sync/conflicts/:id/resolve` |
| Settings | `GET /api/settings/repository`、`PUT /api/settings/repository` |
| GitHub OAuth | `POST /api/auth/github/login`、`GET /api/auth/github/callback`、`GET /api/auth/github/status`、`DELETE /api/auth/github` |
| GitHub | `GET /api/github/repositories` |
| Maintenance | `POST /api/maintenance/reset/prepare`、`POST /api/maintenance/reset/execute` |

写入类 DTO 使用全局 `ValidationPipe` 的 `transform + whitelist + forbidNonWhitelisted` 校验；笔记写入仍只允许 Markdown，路径安全规则统一由 `PathPolicy` 执行。

## 运行时配置

默认行为不变，也可以通过环境变量覆盖：

- `PORT`：HTTP 端口，默认 `3000`。
- `HOST`：监听地址，默认 `0.0.0.0`。
- `WEB_ORIGIN`：OAuth 成功或失败后的 Web 跳转地址，默认 `http://localhost:5173`。
- `GITHUB_OAUTH_CALLBACK_URL`：GitHub OAuth 回调地址，默认 `http://127.0.0.1:3000/api/auth/github/callback`。

编译产物入口为 `dist/src/main.js`，`package.json` 和 Docker 启动命令已统一到该入口。

## 兼容策略

根目录的 `services.ts`、`controllers.ts` 现在只保留 re-export，用于兼容旧测试和外部导入；新代码应从具体模块文件导入，不再向聚合文件添加业务实现。
