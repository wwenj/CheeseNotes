# CheeseNotes / 芝士笔记

> 一个以 Markdown 为唯一内容格式、以 GitHub 仓库为可验证远端副本的个人笔记系统。

CheeseNotes 面向希望长期拥有、组织和使用自己笔记的人。它不是把 Markdown 上传到某个不可见的 SaaS 数据库，而是将笔记放入用户有写入权限的 GitHub 仓库；同时提供一套比直接编辑仓库文件更适合日常写作、阅读和移动使用的应用体验。

产品由 Web 客户端、NestJS 服务端和 Capacitor iOS 壳组成。服务端持有一个真实 Git working tree，负责安全写入、GitHub 授权、标准 Git 同步与冲突处理；SQLite 只保存索引和协调元数据。Web 和 iOS 都通过同一套 API 使用它。

## 1. 产品定位与核心原则

### 1.1 解决的问题

纯 Markdown 的优点是开放、可迁移、适合 Git 管理，但日常体验往往需要在文件管理器、编辑器、Git 客户端和移动端之间切换。CheeseNotes 将这些能力收敛为一个工作台：

- 用文件树和全文标题搜索管理笔记库；
- 用阅读视图和所见即所得的写作视图写 Markdown；
- 在 Web、iOS 和 GitHub 仓库之间保持同一份内容；
- 在真正确认远端提交与内容一致前，不把状态写成“已同步”；
- 发生并发修改时保留本地内容，并要求用户显式决定如何处理。

### 1.2 设计原则

1. **Markdown 优先**：可写入内容仅限 `.md`，标题、正文、内部链接和图片引用都保留在标准文件中。
2. **GitHub 是可携带的远端副本**：用户可以直接用 GitHub、git 或其他 Markdown 工具访问仓库；CheeseNotes 不锁定数据格式。
3. **服务端 Git 工作副本优先于浏览器直写**：每次编辑先原子写入真实 working tree，再由同步协调器串行提交和推送，避免浏览器端承担 Git 并发和令牌安全问题。
4. **同步状态必须可证明**：`verified` 的含义不是“请求已发出”，而是本地 HEAD、generation 和 GitHub 远端 ref 已验证一致。
5. **阅读与写作是一件事的两个视图**：读模式服务于沉浸和跳转，写模式服务于自然编辑；两者使用同一 Markdown 内容，而非两套文档模型。
6. **移动端按原生使用方式设计**：iOS 采用安全区域、抽屉手势、稳定的文本键盘和受保护的本地凭据存储。

## 2. 系统概览

```text
┌──────────────────────────────┐
│ Web / iOS Capacitor App      │
│ React + CodeMirror + Cache   │
└──────────────┬───────────────┘
               │ X-Device-Token + /api
┌──────────────▼───────────────┐
│ CheeseNotes Server            │
│ NestJS + Fastify             │
│                              │
│ Git working tree：全部文件    │
│ SQLite：索引/任务/冲突元数据  │
│ Sync：fetch/merge/push/verify │
└──────────────┬───────────────┘
               │ GitHub OAuth / standard Git
┌──────────────▼───────────────┐
│ 用户拥有写入权限的 GitHub 仓库 │
│ 默认分支上的 Markdown 与资源   │
└──────────────────────────────┘
```

### 2.1 运行单元

| 单元 | 技术 | 职责 |
| --- | --- | --- |
| `web/` | React 19、TypeScript、Vite、CodeMirror 6 | 笔记工作台、阅读/写作、缓存、同步与冲突界面 |
| `server/` | NestJS 11、Fastify、SQLite | 鉴权、笔记 API、GitHub OAuth、同步 Worker、静态资源托管 |
| `ios-capacitor/` | Capacitor 8、iOS WebView | 复用 Web 应用，提供 iOS 安全存储与原生容器能力 |
| GitHub | OAuth + Git Smart HTTP | 用户管理的远端笔记仓库与版本历史 |

服务端是模块化单体：`auth`、`settings`、`notes`、`sync`、`github`、`storage` 和 `database` 有清晰边界，但部署时仍是一个进程、一套 API 与一个持久运行目录。这让个人笔记服务保持足够简单，也保留了仓库锁和恢复流程所需的一致性。

## 3. 用户旅程

### 3.1 第一次使用

1. 用户打开客户端，先通过 Authenticator 的 6 位动态码验证设备。
2. 通过 GitHub OAuth 授权，服务端获取仓库读写能力；客户端不接触 Client Secret 或 GitHub Access Token。
3. 用户从有 `push` 权限的仓库中选择一个笔记库。
4. 服务端以 `depth=1` clone 该仓库默认分支的当前版本，将支持的文件纳入索引。
5. 客户端加载文件树，用户可直接阅读、搜索和创建 Markdown 笔记。

### 3.2 日常编辑

用户新建或修改文章后，客户端以静默自动保存方式把内容提交到服务端。服务端用同目录临时文件和原子 rename 写入 working tree，更新 revision/index/generation，再安排同步。用户切换文章、退出写作模式、主动同步或应用进入后台时，会先尝试 flush 当前编辑队列。

这里的“保存”和“同步”分为两个阶段：

- **已保存到服务端**：内容已进入本机 Git working tree，可继续读取和编辑；
- **已验证同步**：远端默认分支已更新，并确认 GitHub ref 指向本次 candidate commit。

### 3.3 外部修改与冲突

如果用户在 GitHub 或其他设备上改了同一篇笔记，下次同步会先比较远端内容、服务端记录的基线内容和本地工作副本。没有本地未同步改动时，远端版本直接进入本地；两侧都变更时，系统创建冲突记录，并保留本地内容为一个带设备与 revision 标识的冲突副本。用户可选择：

- 采用远端；
- 保留本地；
- 保留两个版本；
- 对单条冲突进一步手工编辑内容。

冲突未处理前，同步状态是 `conflict`，不会悄悄覆盖任何一方内容。

## 4. 前端体验设计

### 4.1 工作台而不是传统后台

应用主路径只有三个面板：笔记库 `/`、同步 `/sync` 和设置 `/settings`。`App.tsx` 负责组合，`useWorkspaceController` 集中管理授权、仓库、文件树、当前文章、编辑队列、同步状态和本地阅读缓存，避免页面组件各自维护不一致的数据源。

桌面端左侧是常驻 Explorer：品牌与同步状态、搜索与文件树、创建文件/文件夹工具、设置入口被组织成固定的信息密度。文件名展示会隐藏普通扩展名，但保留 dotfile 语义；长标题会截断而不会侵入正文区域。正文区只保留一个固定的轻量工具条：文件列表、读写切换、文章动作和刷新状态都在触手可及的位置，不占用文章阅读空间。

未选择文章时显示欢迎页：新建入口、笔记总数、同步状态和最近阅读共同构成一个最小首页，而不是空白画布。

### 4.2 阅读体验

读模式将 Markdown 渲染为干净、可调字号的文章：

- 使用 `react-markdown` + GFM，支持表格、任务列表、删除线等常见语法；
- 支持 Obsidian 风格的 `[[内部链接]]`、`![[嵌入文件]]` 与常见 Markdown 图片引用；
- 内部链接在应用内打开，图片、音频、视频和 PDF 走统一资源预览；
- 不可信的 Markdown HTML 会被服务端 `sanitize-html` 清洗，客户端链接也限制为安全协议；
- 顶部控制区固定悬浮，正文排版保持克制，标题与正文之间只有浅分割线；
- 最近访问文章会保存在客户端设置中，方便回到上次阅读位置。

媒体文件并不被当成笔记正文写入。它们随默认分支当前版本直接存在 working tree，并由服务端流式读取；视频和音频接口支持 HTTP Range，适合流式加载与拖动播放。

### 4.3 写作体验：Markdown 源码与实时视觉反馈并存

写模式不是把 Markdown 转换成不可逆的富文本，而是用 CodeMirror 编辑原始 Markdown，并在非焦点区域做轻量的实时视觉替换：

- 文章标题是独立输入框，修改后同步写回首个 `# 标题`；标题也用于生成稳定、可读的 `.md` 文件名；
- 当前编辑行保留 Markdown 标记，让用户能直接修改语法；非焦点行隐藏冗余标记、保留排版结果；
- 无序列表、有序列表和任务列表显示与读模式一致的视觉 marker；
- 标题、强调、删除线、行内代码、引用与代码块用同一套排版语义展示；
- 独占一行的图片引用直接显示预览，点击预览可回到对应源码位置；
- `Cmd/Ctrl + S` 可立即 flush，普通输入使用自动保存；
- CodeMirror 明确声明 `inputmode=text`，移动端输入字号至少 16px，避免 iOS 自动放大或优先弹出数字键盘。

这种设计的关键是：文档文件永远是 Markdown；写作界面只是在不牺牲源码可见性的前提下，减少阅读语法符号的负担。

### 4.4 保存、切换与失败反馈

前端使用单个 `AutoSaveQueue` 管理每篇文章的编辑任务：默认 5 秒防抖；请求失败会按 1、2、5、10、30 秒退避重试；revision 冲突会停止自动覆盖并提示用户。临时 draft 只存在当前编辑会话的内存中，不会成为另一份长期同步数据源。

切换文章、退出写作、切换仓库、主动同步和页面变为后台都会先 flush 队列。若 flush 失败，客户端明确告知未提交内容不能同步，并恢复服务端版本；不会用“未保存离开”弹窗打断正常写作流。普通成功或失败反馈使用 5 秒自动消失的 toast，确认删除等不可逆动作才需要明确确认。

### 4.5 缓存与加载策略

阅读场景优先响应速度，但不能让缓存伪装成最新内容：

- 文档采用 memory LRU + IndexedDB 两级缓存，内存最多 24 篇或 8 MiB，持久缓存最多 100 MiB；
- 打开文章时先显示与当前 revision 匹配的缓存，再静默校验服务端版本；版本不一致时显示“正在更新”，失败时明确显示“当前是缓存版本”并提供重试；
- 文档 API 使用 revision 作为 ETag，支持 `304 Not Modified`；
- 资源采用 Cache Storage + IndexedDB 索引，最多 300 MiB，并按最近访问时间清理；资源 URL 携带 `assetVersion`，使版本变更天然失效；
- 编辑器采用 `React.lazy` 分包，阅读优先，进入写作时才加载 CodeMirror；
- 生产静态资源使用 immutable 长缓存，`index.html` 使用 `no-cache`，保证新版本应用壳能及时更新。

### 4.6 iOS 体验

iOS 不是另一套业务实现，而是通过 Capacitor 打包同一个 Web 应用。容器层补足移动端差异：

- 支持 `viewport-fit=cover` 与 safe area，控制区不会被刘海或 Home Indicator 遮挡；
- 文件树为移动抽屉，正文任意位置可右滑打开、抽屉内左滑关闭，并跟随手指拖动；
- 打开抽屉时锁住底层文章滚动，关闭后恢复原滚动位置；
- 设置页支持左滑返回；
- 设备令牌存入 iOS Keychain 的 `whenUnlockedThisDeviceOnly`，不落普通 Web 存储；
- 打包脚本将 API 地址注入独立 `www/` 副本，不修改 `web/` 源码配置。

## 5. Markdown 与文件模型

### 5.1 支持范围

服务端路径策略拒绝绝对路径、`..`、隐藏目录和服务自身目录，并只允许受支持的文本/资源扩展名进入笔记库。写入接口仅允许 `.md`，这保证文章编辑不会意外改写任意二进制文件。

文件树会同时展示远端已有文件以及新建空文件夹。空文件夹用隐藏 `.gitkeep` 表示并进入 Git 历史，文件树不会显示 `.gitkeep` 本身。

### 5.2 文件名与 revision

笔记有稳定 `id`，路径不是唯一身份。保存时会根据 Markdown 标题生成可读文件名，并替换不合法字符；重命名后仍可通过 `id` 识别同一篇文章。`revision` 是内容哈希，用于三件事：

1. 客户端写入时的乐观并发控制；
2. 文档缓存与 ETag 校验；
3. working tree 读取、HTTP ETag 和结构操作前的 revision 校验。

删除直接发生在 working tree，并立即从可重建索引移除；同步失败时由 snapshot 恢复，历史恢复依赖 Git。

## 6. 权限与安全设计

### 6.1 三层边界

| 边界 | 机制 | 目的 |
| --- | --- | --- |
| 设备访问 | Authenticator TOTP + `X-Device-Token` | 不让未验证设备调用笔记、同步与仓库 API |
| GitHub 授权 | OAuth state、PKCE S256、10 分钟有效期 | 防止 OAuth 请求伪造，避免客户端持有 Client Secret |
| 仓库权限 | 只列出 GitHub 返回 `push` 权限的仓库，并在读取仓库元信息时再次校验 | 服务只能操作当前账号可写的仓库 |

除 `GET /api/access/status`、`POST /api/access/verify` 和 GitHub OAuth callback 外，API 全部经过 `DeviceGuard`。Authenticator 连续失败最多 5 次，5 分钟内限流；验证码容忍前后一个 30 秒时间窗口。

设备验证成功后，服务端签发带 HMAC 签名的设备令牌。Web 版存入浏览器 localStorage；iOS 版使用 Secure Storage/Keychain。每次 API 请求自动附加 `X-Device-Token`，服务端拒绝时客户端会立即清除本地令牌并回到验证界面。

### 6.2 GitHub 凭据与数据边界

GitHub OAuth 的 Client ID、Client Secret 和 Git transport 配置只从 `server/config/github-oauth.local.json` 读取；Web origin 与服务 origin 从 `config/.env.local` 读取，并据此生成 OAuth callback。Authenticator Secret 同样是服务端本地文件。这些本地配置均被 Git 忽略，仓库只保留 example 文件。

OAuth 成功得到的 GitHub Access Token 仅保存在服务端 SQLite settings 中，不会返回浏览器或 iOS 页面。Git 子进程通过临时 `GIT_ASKPASS` 环境读取 token，remote URL、Git config、命令参数和日志都不包含 token。断开 GitHub 时，服务端会清空 token、仓库设置、working tree 和同步记录；客户端也会删除相应的阅读缓存。

服务端默认将 `capacitor://localhost` 和配置的 Web origin 放入 CORS 白名单，并开放完整的读写预检方法。输入 DTO 使用 `transform + whitelist + forbidNonWhitelisted` 校验，路径再经过统一 `PathPolicy`，因此“通过 API 写出工作目录”的路径穿越并不在允许范围内。

## 7. 服务端与 GitHub 的双向同步

### 7.1 为什么使用真实 Git working tree

手工调用 GitHub Contents/Git Data API 等于重新实现一部分 Git：多文件事务、二进制 blob、rename、三方冲突、push 竞争、崩溃恢复都要自行拼装。CheeseNotes 直接使用系统 Git，让 `repository/` 成为唯一内容副本：

- `file_index`：稳定 ID、路径、字节 revision、标题、类型和时间，可随时从 working tree 重建；
- `repository_state`：仓库、固定分支、local/remote HEAD、generation、锁和同步状态；
- `sync_jobs`：base/snapshot/candidate commit 和任务阶段，用于崩溃恢复；
- `conflicts`：三方 commit、三方临时文件和用户决策；
- 文本和二进制内容只存在 working tree 和 Git 对象中，不进入 SQLite。

### 7.2 同步状态机

| 状态 | 含义 |
| --- | --- |
| `unconfigured` | 尚未选择仓库 |
| `unauthorized` | 没有可用 GitHub Token |
| `pending` | 本地存在 dirty 内容，等待或准备同步 |
| `checking` | 正在 clone 或 fetch 远端默认分支 |
| `syncing` | 正在提交或验证本次变更 |
| `conflict` | 检测到并发修改，需用户处理 |
| `failed` | 本次同步失败，等待退避重试 |
| `verified` | 当前 generation 与远端 head 已被验证一致 |

服务端启动、GitHub 授权完成、客户端首次打开仓库、客户端每 15 分钟以及用户主动点击同步，都会触发同步检查。普通编辑后的服务端同步采用 10 分钟静默窗口；主动同步会取消等待、先 flush 客户端编辑队列，再等待最多 90 秒直到状态进入 `verified`。这就是 UI 中“同步成功”的严格定义。

### 7.3 从 GitHub 拉到服务端

首次绑定执行 `--depth=1 --single-branch --no-tags` shallow clone，只下载默认分支当前版本，远端完整历史不受影响。后续同步执行 `git fetch origin`：working tree 干净时直接更新到远端 HEAD；存在本地 snapshot 时，以远端 HEAD 为基线 cherry-pick snapshot。远端默认分支发生变化时要求重新选择仓库，不静默换分支。

### 7.4 从服务端推到 GitHub

1. 校验 working tree，只允许支持文件和 `.gitkeep` 进入 stage；
2. 将本地变化创建为 snapshot commit，并用内部 ref 保留恢复点；
3. fetch 后远端若前进，则在远端 HEAD 上 cherry-pick snapshot；
4. 发生冲突时使用 Git index stage 1/2/3，主路径采用远端，本地版本写为冲突副本；
5. 使用普通 fast-forward `git push`，从不 force push；
6. 用 `git ls-remote` 验证远端 ref 等于 candidate 后才进入 `verified`；
7. push 竞争或验证失败时恢复同步前的未提交 working tree，进程重启则根据 `sync_jobs` 和 snapshot ref 继续确认或恢复。

### 7.5 冲突决策如何落地

检测到冲突时，系统把本地版本复制为 `原文件名（冲突-冲突标识）.md`，并保留原文件的远端版本作为当前主路径。处理页可批量或逐条选择决策：

- **采用远端**：删除冲突副本；
- **保留本地**：把冲突副本内容写回原路径，再删除副本；
- **保留两个版本**：保留远端主文件与本地冲突副本；
- **手动内容**：将用户提供的内容写回原路径。

决策只先写入 SQLite 元数据，点击“处理冲突”后才写入 working tree 并再次进入正常同步。界面使用乐观更新，避免逐条选择时闪烁；但最终结果仍以服务端远端 ref 验证为准。

## 8. API 与模块边界

所有业务接口位于 `/api` 下，成功响应保持原始 JSON，便于 Web 和 iOS 共用。核心接口如下：

| 领域 | 主要接口 |
| --- | --- |
| 设备访问 | `GET /access/status`、`POST /access/verify` |
| GitHub 授权 | `POST /auth/github/connect`、`GET /auth/github/callback`、`GET /auth/github/status`、`DELETE /auth/github` |
| 仓库设置 | `GET/PUT /settings/repository`、`GET /github/repositories` |
| 笔记 | `GET /tree`、`GET /tree/management`、`POST /tree/changes`、内容/资源/搜索接口、`POST/PUT/DELETE /notes`、`POST /folders` |
| 同步 | `GET /sync/status`、`POST /sync`、冲突列表/详情/决策/应用接口 |

服务端依赖关系保持单向：Notes 写入 `RepositoryWorkspaceService` 后只调用 Sync 的调度能力；Sync 依赖 GitProcess、Workspace、Settings、GitHub metadata 和 Database，但不反向依赖 NoteService。

## 9. 部署与开发

### 9.1 本地开发

```bash
# 服务端
cd server
pnpm install
pnpm start:dev

# Web 客户端（Vite 会把 /api 转发至 3000）
cd web
pnpm install
pnpm dev
```

首次启动前，需要由部署者创建以下仅本机保存的配置文件：

```text
server/config/github-oauth.local.json
server/config/authenticator-secret.local.txt
config/.env.local
```

可以从对应的 `.example` 文件复制；不要把真实 Client Secret、Authenticator Secret 或运行时 SQLite 数据提交到仓库。

### 9.2 构建与运行时数据

根目录的 `build.sh` 会依次构建 Web、复制 `web/dist` 到 `server/public`、安装服务端依赖并构建 NestJS 产物。生产服务由同一 Nest/Fastify 进程托管 API 和 Web 静态文件，因此 Web 使用同域 `/api`，无需向用户暴露单独的服务地址。

运行时笔记与元数据不写入源码目录：本地默认在 `../.runtime`，Docker 环境固定为 `/var/lib/note-service`。部署时应把该目录配置为持久卷，并同时安全注入 OAuth 与 Authenticator 配置文件。

### 9.3 iOS 构建

```bash
cd ios-capacitor
pnpm install
pnpm ios:sync                 # Simulator，默认 127.0.0.1:3000
pnpm ios:sync:production      # 注入生产 HTTPS 服务地址
pnpm ios:open
```

Capacitor 打包的是独立的 `www/` 产物。线上服务需允许 `capacitor://localhost` 的 CORS 预检与 `GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS` 方法。

## 10. 当前边界与后续方向

当前实现有意保持以下边界：

- 以个人单服务、单工作副本为目标，不是多人实时协同编辑器；
- 首次同步只 shallow clone 绑定时默认分支的当前版本，产品界面不展示完整 Git 历史；
- 空文件夹通过隐藏 `.gitkeep` 进入 Git 历史；
- 不支持 Git LFS、子模块和符号链接文件；
- 写作仅开放 Markdown，媒体以读取和预览为主；
- 收藏入口已预留在文章操作中，但功能尚未实现；
- iOS 壳复用 Web，不额外维护一套原生笔记业务逻辑。

后续可在不破坏这些核心约束的前提下，增加全文内容索引、收藏与标签、更多导入格式、仓库级同步策略、提交历史浏览和更细粒度的冲突 diff。无论功能如何扩展，Markdown 可迁移性、设备与凭据隔离、以及“verified 必须代表真实一致”的同步语义应保持不变。

## 11. 代码入口速查

| 关注点 | 入口 |
| --- | --- |
| 应用组合与设备验证 | `web/src/App.tsx` |
| Web 状态、保存与同步编排 | `web/src/app/useWorkspaceController.ts` |
| Markdown 写作体验 | `web/src/components/MarkdownLiveEditor.tsx` |
| Markdown 阅读与内部链接 | `web/src/components/MarkdownRenderer.tsx` |
| iOS 抽屉和安全区域交互 | `web/src/components/layout/WorkspaceShell.tsx` |
| 客户端缓存 | `web/src/lib/workspace-cache.ts` |
| 自动保存队列 | `web/src/lib/autosave.ts` |
| 服务端笔记写入 | `server/src/modules/notes/note.service.ts` |
| 双向同步 Worker | `server/src/modules/sync/sync.service.ts` |
| GitHub API 封装 | `server/src/modules/github/github.service.ts` |
| 设备与 OAuth 授权 | `server/src/modules/auth/` |
| 数据库 schema | `server/src/modules/database/database.service.ts` |
