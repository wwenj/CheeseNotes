# note-service

个人 Markdown 笔记服务与 iOS 客户端。运行时数据始终放在 Docker 持久卷，源码目录不保存笔记副本。

```bash
cd server
pnpm install
npm run start:dev
```

GitHub OAuth 凭据仅保存在 `server/config/github-oauth.local.json`，该文件被 Git 忽略。首次部署时从 `server/config/github-oauth.example.json` 复制并填写本地、生产两套 OAuth App 信息；客户端只需点击连接 GitHub，不需要也不会接触 Client Secret。GitHub OAuth App 的 Authorization callback URL 分别使用配置文件中的 `authorizationCallbackUrl`。

每个环境在同一份配置中通过 `gitTransport` 选择 Git remote：`https`（默认）使用 OAuth token，`ssh` 使用部署机 SSH key 和 `git@github.com:owner/repo.git`。OAuth 仍只用于 GitHub API 的仓库读取和授权校验。

服务端首次绑定时会以 `depth=1` clone GitHub 默认分支的当前版本，真实 Git working tree 是文本、图片、PDF 和音视频的唯一服务端内容副本。保存先原子写入 working tree，随后由单一同步协调器通过标准 `fetch/add/commit/cherry-pick/push` 完成 fast-forward 同步，并以远端 ref 验证结果；未验证前不会显示“已同步”。远端完整 Git 历史不会被修改，SQLite 只保存索引、仓库状态、任务、冲突元数据、设置和凭据，不保存文件正文。

本地开发数据默认位于仓库根目录 `.runtime`，Docker 内固定为 `/var/lib/note-service`：

```text
/var/lib/note-service/
├── meta/noteai-git.sqlite
├── repository/              # 包含 .git 的真实 working tree
└── git-jobs/                # 崩溃恢复和冲突临时文件
```

新架构不读取或迁移旧 `meta/notes.sqlite`。检测到旧数据库时会拒绝启动；升级部署必须先停止旧服务并清空旧运行数据，本地开发切换时同样需要清空 `.runtime`，随后再从 GitHub 重新 clone。GitHub Access Token 仅保存在服务端 SQLite，通过临时 `GIT_ASKPASS` 环境交给 Git 子进程，不写入 remote URL、Git config、命令参数或日志。

服务端模块划分、依赖方向和接口契约见 [server/ARCHITECTURE.md](server/ARCHITECTURE.md)。

作为开源项目的完整产品设计、前端体验、Markdown 读写、权限和 GitHub 双向同步说明见 [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)。

## Web 客户端

```bash
cd web
pnpm install
pnpm dev
```

开发服务器会将 `/api` 请求转发到 `http://localhost:3000`。生产镜像可在仓库根目录执行 `docker build -f server/Dockerfile -t noteai .` 构建；镜像会自动构建 Web 页面并由同一服务根路径提供，同域访问无需填写服务地址。运行时必须把持久卷挂载到 `/var/lib/note-service`。
