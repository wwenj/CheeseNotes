# note-service

个人 Markdown 笔记服务与 iOS 客户端。运行时数据始终放在 Docker 持久卷，源码目录不保存笔记副本。

```bash
cd server
pnpm install
npm run start:dev
```

GitHub OAuth 凭据仅保存在 `server/config/github-oauth.local.json`，该文件被 Git 忽略。首次部署时从 `server/config/github-oauth.example.json` 复制并填写本地、生产两套 OAuth App 信息；客户端只需点击连接 GitHub，不需要也不会接触 Client Secret。GitHub OAuth App 的 Authorization callback URL 分别使用配置文件中的 `authorizationCallbackUrl`。

服务只读取仓库当前默认分支，不会 clone Git 历史。文本笔记先在 SQLite 事务中持久化，再由单一同步 Worker 以 GitHub Git Data API 原子提交并逐字节回读验证；未验证前不会显示“已同步”。文件系统只缓存媒体资源和旧数据迁移来源。本地开发数据在 `note-service/.runtime`，Docker 内固定为 `/var/lib/note-service`。授权成功后的 GitHub Access Token 仅明文保存在当前服务本机的 SQLite 中，不会返回或存入 Web 页面。

服务端模块划分、依赖方向和接口契约见 [server/ARCHITECTURE.md](server/ARCHITECTURE.md)。

## Web 客户端

```bash
cd web
pnpm install
pnpm dev
```

开发服务器会将 `/api` 请求转发到 `http://localhost:3000`。生产环境执行 `docker compose -f deploy/docker-compose.yml up --build -d` 时，会自动构建 Web 页面并由同一服务根路径提供；同域访问无需填写服务地址。
