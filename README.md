<p align="center">
  <img src="ios-capacitor/ios/App/App/CheeseLaunchSplash.png" alt="CheeseNotes 芝士笔记" width="180" />
</p>

<h1 align="center">芝士，就是力量！！</h1>
<p align="center">CheeseNotes（芝士笔记）自部署、无广告的 Markdown 笔记与 GitHub 双向同步的 Web + IOS APP 开源项目</p>

## 项目简介

CheeseNotes（芝士笔记）是一套以 iOS 使用体验为中心的个人笔记系统。它把 Markdown 文件保留在用户自己的 GitHub 仓库中，以自部署服务负责可靠读写和双向同步，让手机上的记录、阅读与整理不再受传统自部署笔记系统的网络延迟、文件分散和同步状态不透明所限制。

项目不内置广告，也不把笔记正文交给第三方 SaaS。Markdown 与附件始终是可直接访问、可迁移的文件；GitHub 仓库是可验证的远端副本。

## 主要特色

- **为 iOS 而生的笔记体验**：通过 Capacitor 打包为原生 iOS App，适配原生键盘、相机选图和安全存储；阅读、编辑、插图与文件管理集中在一个轻量工作台中。
- **快速打开，专注写作**：App 内置页面资源，并缓存最近访问的文章和资源，减少重复请求与等待；Markdown 编辑保留源码可见性，同时提供实时的阅读反馈。
- **Authenticator 验证，简单而安全**：首次输入 6 位 Authenticator 验证码即可在当前设备完成验证，设备凭据使用安全存储保存；服务端对受保护接口校验设备令牌，未验证设备不能读取或修改笔记。
- **Markdown 是唯一内容格式**：笔记直接以 `.md` 保存，支持常见 Markdown、GFM、内部链接与图片引用。不锁定私有文档格式，随时可以用 Git、GitHub 或其他 Markdown 工具继续使用。
- **GitHub 双向同步**：首次连接仓库后，服务端创建真实 Git working tree；本地保存、远端更新、提交、合并与推送都通过标准 Git 流程完成。
- **同步结果可验证**：服务端在 push 后再次读取远端 ref；只有远端提交确实与预期一致，才会显示“已同步”。发生并发修改时保留冲突信息和处理入口，不把未确认状态伪装成成功。
- **自部署但不牺牲可用性**：SQLite 只保存索引、同步状态、任务与必要凭据，笔记正文和附件保留在挂载的数据卷中的 Git 工作树；服务重启后仍可从 GitHub 恢复内容。

## iOS 操作一览

从主屏进入、启动并打开首页；随后阅读、写作与管理文章，最后浏览知识库、调整设置并管理仓库同步。以下三组展示图均由真实手机截图直接合成。

<p align="center">
  <img src="assets/screenshots/ios-showcase-01-source.png" alt="从主屏、启动页到 CheeseNotes 首页总览" width="900" />
</p>

<p align="center">
  <img src="assets/screenshots/ios-showcase-02-source.png" alt="阅读、Markdown 写作与文章操作" width="900" />
</p>

<p align="center">
  <img src="assets/screenshots/ios-showcase-03-source.png" alt="知识库目录、设置与仓库同步" width="900" />
</p>

## 设计概览

```text
iOS App
  │  阅读、编辑、图片与文件管理
  ▼
CheeseNotes 服务端（NestJS + Fastify）
  │  SQLite：状态、索引、同步任务与凭据
  ▼
持久卷中的 Git working tree
  │  fetch / commit / merge / push / 远端 ref 校验
  ▼
用户自己的 GitHub 仓库
```

## 运行方式

服务端需要 Node.js 与 pnpm。先按下方“私有化部署前配置”创建服务端配置；客户端不会接触 GitHub OAuth 的 Client Secret。

```bash
cd server
pnpm install
npm run start:dev
```

生产镜像可在仓库根目录构建。运行时请将持久卷挂载到 `/var/lib/note-service`，其中包含 SQLite 元数据、真实 Git 工作树及同步任务的恢复文件。

```bash
docker build -f server/Dockerfile -t cheesenotes .
```

## 私有化部署前配置

服务端全部手动配置统一在 [`server/config`](server/config/)。复制模板后填写，`runtime.local.json` 已被 Git 忽略，绝不能提交。

```bash
cp server/config/runtime.example.json server/config/runtime.local.json
```

配置文件同时包含 `development` 和 `production`；`NODE_ENV=production` 时读取后者，其他情况读取前者。部署前至少确认以下项：

- `webOrigin`、`serviceOrigin`：用户访问的 Web 地址与服务端公开地址。GitHub OAuth App 的 Authorization callback URL 必须设为 `${serviceOrigin}/api/auth/github/callback`。
- `corsOrigins`：额外允许的跨域来源；iOS App 保留 `capacitor://localhost`。
- `dataRoot`：可写且持久化的数据目录。Docker 默认使用 `/var/lib/note-service`，必须挂载为持久卷。
- `host`、`port`：服务监听地址与端口。
- `authenticatorSecret`：唯一的 Base32 TOTP Secret，用于 Authenticator 验证和设备令牌签名；生产环境请重新生成，变更后所有已验证设备都需再次验证。
- `githubOAuth.clientId`、`githubOAuth.clientSecret`：对应环境的 GitHub OAuth App 凭据；`gitTransport` 选 `https` 或 `ssh`。使用 `ssh` 时还需在运行服务的系统账户中配置 GitHub SSH 私钥与 `known_hosts`。

Docker 镜像内包含模板文件。运行容器时将填写后的 `server/config` 挂载到 `/app/config`，并将数据卷挂载到配置中的 `dataRoot`。iOS 打包地址仍由仓库根目录 [`config/.env.local`](config/.env.example) 的 `NOTEAI_SERVICE_ORIGIN` 配置。

## iOS 开发

```bash
cd ios-capacitor
pnpm install
pnpm ios:sync
```

`pnpm ios:sync:production` 会将生产服务地址写入独立的 iOS 打包副本，随后可在 Xcode 中打开 `ios/App/App.xcworkspace` 运行。
