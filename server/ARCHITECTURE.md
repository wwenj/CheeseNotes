# Server architecture

服务端是 NestJS/Fastify 模块化单体。真实 Git working tree 是唯一文件内容工作副本；GitHub 是远端；SQLite 只保存可重建索引和协调元数据。

## 运行目录

```text
/var/lib/note-service/
├── meta/noteai-git.sqlite
├── repository/                 # 完整默认分支和 .git
└── git-jobs/                   # snapshot ref、冲突三方文件和恢复状态
```

本地开发可通过 `NOTEAI_DATA_ROOT` 覆盖目录，默认使用仓库根目录 `.runtime`。检测到旧 `meta/notes.sqlite` 时直接拒绝启动，不执行兼容读取或迁移。

## 模块边界

- `GitProcessService`：唯一 Git 子进程入口。基于 `simple-git` 设置硬超时、错误分类和受控环境；网络命令通过临时 `GIT_ASKPASS` 读取 token。
- `RepositoryWorkspaceService`：扫描 working tree、原子写文件、移动/删除、`.gitkeep` 空目录、安全校验和 `file_index` 重建。
- `SyncService`：仓库独占锁、snapshot commit、fetch/cherry-pick、fast-forward push、远端 ref 验证、冲突落盘和崩溃恢复。
- `NoteService`：文件 API、revision 并发校验、标题改名和文件树操作预检；不保存正文到 SQLite。
- `GitHubService`：OAuth、账号、仓库列表、push 权限和默认分支查询；不包含 blob/tree/commit/raw/contents 文件操作。
- `DatabaseService`：从零创建新 schema，不包含 legacy migration。

依赖方向：

```text
Notes ───────> Workspace ───────> File system
  │                │
  └──────> Sync ───┼──────> GitProcess ───────> system git
                   ├──────> GitHub metadata API
                   └──────> SQLite metadata
```

## SQLite schema

- `file_index(id,path,revision,title,kind,updated_at)`：可从 working tree 重建，不存正文和远端 blob。
- `repository_state`：固定仓库/分支、local/remote HEAD、generation、verified generation、状态、阶段、锁和错误。
- `sync_jobs`：任务类型、阶段、base/snapshot/candidate commit、操作清单和错误。
- `conflicts`：路径、冲突副本、三方 commit、三方临时文件、类型和用户决策。
- `settings`、`devices`、`github_oauth_states`：设置、设备和 OAuth 元数据。

## Working tree 规则

- 文本保存使用同目录临时文件和原子 rename；Markdown 一级标题改名直接移动真实文件。
- 图片、PDF、音视频直接从 working tree 流式读取，ETag 使用文件字节 SHA-256 revision。
- 只展示、读取和 stage 支持的文件以及内部 `.gitkeep`；其他仓库文件完整保留。
- 不支持文件若在服务端被本地修改，整次同步返回 `UNSUPPORTED_LOCAL_CHANGES`，不会执行 `git add -A`。
- 符号链接和子模块不展示、不读取；包含不受管理内容的目录禁止整体移动或删除。
- 空目录用 `.gitkeep` 表示并在文件树隐藏。

## 同步事务

普通同步在仓库锁内执行：

1. 校验默认分支、remote URL、working tree 和可 stage 路径。
2. 把允许的本地变化提交为 snapshot，并创建 `refs/noteai/jobs/<id>/snapshot`。
3. `git fetch origin`；远端前进时，以远端 HEAD 为基线 cherry-pick snapshot。
4. 冲突时从 Git index 的 stage 1/2/3 写出 base/remote/local，主路径采用远端，本地版本生成冲突副本。
5. `git push origin HEAD:refs/heads/<branch>`，禁止 force push。
6. 使用 `git ls-remote` 验证远端 ref 等于 candidate，随后重建索引并进入 `verified`。
7. push 竞争时恢复 snapshot 并自动重试一次；其他失败保留同步前的未提交 working tree，任务阶段和当前 HEAD 用于进程重启恢复。

文件管理确认使用相同锁和 Git 链路，但在任何结构变更前 fetch 并要求远端 HEAD 等于本地基线。原有未提交编辑先形成 snapshot，全部移动/删除在真实 working tree 中执行，再相对 base 压成一个最终 commit。失败恢复 snapshot，结构修改不残留；若远端已前进，则先更新本地基线再返回 `REMOTE_CHANGED`，页面刷新后可直接重新整理。

保存与同步双向互斥；任一方向遇到 working tree 正在写入都立即返回 `423 SYNC_BUSY`。前端 autosave 静默退避重试，不让请求长时间挂起。

## API

全局前缀为 `/api`：

| 模块 | 接口 |
| --- | --- |
| 文件 | `GET /tree`、`GET /tree/management`、`POST /tree/changes` |
| 内容 | `GET /notes/content`、`GET /notes/render`、`GET /files`、`GET /search` |
| 写入 | `POST/PUT/DELETE /notes`、`POST /folders` |
| 同步 | `GET /sync/status`、`POST /sync`、冲突查询与决策接口 |
| 仓库 | `GET/PUT /settings/repository`、GitHub OAuth 和仓库列表接口 |

`SyncStatus` 只包含真实状态字段：`state`、`phase`、`dirtyCount`、`conflictCount`、`generation`、`verifiedGeneration`、`remoteHead`、`verifiedAt`、`lastError`、`manualSyncAvailable`。

## 部署要求

- 运行镜像必须安装 `git` 和 `ca-certificates`；Git 缺失时启动失败。
- 每个服务实例只绑定一个仓库和绑定时的默认分支。
- 不支持 Git LFS、子模块和符号链接文件。
- 切换版本前停止旧服务并清空旧 `/var/lib/note-service`；GitHub 是唯一切换数据源。
