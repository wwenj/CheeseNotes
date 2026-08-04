<p align="center">
  <img src="ios-capacitor/assets/icon-only.png" alt="NoteAI logo" width="180" />
</p>

<h1 align="center">芝士，就是力量！</h1>
<p align="center">自部署、无广告的 Markdown 笔记与 GitHub 同步服务</p>

## 项目简介

NoteAI 是一套以 iOS 使用体验为中心的个人笔记系统。它把 Markdown 文件保留在用户自己的 GitHub 仓库中，以自部署服务负责可靠读写和双向同步，让手机上的记录、阅读与整理不再受传统自部署笔记系统的网络延迟、文件分散和同步状态不透明所限制。

项目不内置广告，也不把笔记正文交给第三方 SaaS。Markdown 与附件始终是可直接访问、可迁移的文件；GitHub 仓库是可验证的远端副本。

## 主要特色

- **为 iOS 而生的笔记体验**：通过 Capacitor 打包为原生 iOS App，适配原生键盘、相机选图和安全存储；阅读、编辑、插图与文件管理集中在一个轻量工作台中。
- **快速打开，专注写作**：App 内置页面资源，并缓存最近访问的文章和资源，减少重复请求与等待；Markdown 编辑保留源码可见性，同时提供实时的阅读反馈。
- **Markdown 是唯一内容格式**：笔记直接以 `.md` 保存，支持常见 Markdown、GFM、内部链接与图片引用。不锁定私有文档格式，随时可以用 Git、GitHub 或其他 Markdown 工具继续使用。
- **GitHub 双向同步**：首次连接仓库后，服务端创建真实 Git working tree；本地保存、远端更新、提交、合并与推送都通过标准 Git 流程完成。
- **同步结果可验证**：服务端在 push 后再次读取远端 ref；只有远端提交确实与预期一致，才会显示“已同步”。发生并发修改时保留冲突信息和处理入口，不把未确认状态伪装成成功。
- **自部署但不牺牲可用性**：SQLite 只保存索引、同步状态、任务与必要凭据，笔记正文和附件保留在挂载的数据卷中的 Git 工作树；服务重启后仍可从 GitHub 恢复内容。

## 设计概览

```text
iOS App
  │  阅读、编辑、图片与文件管理
  ▼
NoteAI 服务端（NestJS + Fastify）
  │  SQLite：状态、索引、同步任务与凭据
  ▼
持久卷中的 Git working tree
  │  fetch / commit / merge / push / 远端 ref 校验
  ▼
用户自己的 GitHub 仓库
```

## 运行方式

服务端需要 Node.js 与 pnpm。GitHub OAuth 配置放在 `server/config/github-oauth.local.json`，可从示例配置复制后填写；该文件被 Git 忽略，客户端不会接触 Client Secret。

```bash
cd server
pnpm install
npm run start:dev
```

生产镜像可在仓库根目录构建。运行时请将持久卷挂载到 `/var/lib/note-service`，其中包含 SQLite 元数据、真实 Git 工作树及同步任务的恢复文件。

```bash
docker build -f server/Dockerfile -t noteai .
```

## iOS 开发

```bash
cd ios-capacitor
pnpm install
pnpm ios:sync
```

`pnpm ios:sync:production` 会将生产服务地址写入独立的 iOS 打包副本，随后可在 Xcode 中打开 `ios/App/App.xcworkspace` 运行。

更多服务端模块与接口约定见 [server/ARCHITECTURE.md](server/ARCHITECTURE.md)，完整产品设计见 [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)。
