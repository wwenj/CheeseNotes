# NoteAI Capacitor iOS Simulator

这是独立的 Capacitor iOS 工程：它打包 `web/` 的构建产物，但不修改 `web/` 源码、依赖或 Vite 配置，也不使用根目录已有的 `ios/` SwiftUI 工程。

## 范围

- 仅支持 iOS Simulator。
- App 内置 Web 构建产物，并固定访问 `http://127.0.0.1:3000`。
- `127.0.0.1` 对真机指向手机自身；真机、局域网、HTTPS 和 App Store 签名不在本工程范围内。

## 前置条件

已确认本机 Xcode 26.6 与 CocoaPods 1.17.0 可用。

安装本工程依赖并首次生成 iOS 工程：

```bash
cd /Users/zu/Desktop/Code/previte/NoteAI/ios-capacitor
pnpm install
pnpm ios:add
pnpm ios:assets
```

`assets/icon-only.png` 是 iOS 图标唯一输入。`pnpm ios:assets` 生成的 AppIcon 仅写入 `ios-capacitor/ios/`，不会写入 `web/` 或 `server/public/`。

## 本地启动

先启动后端。Capacitor 内置 WebView 的 `capacitor://localhost` 已是服务端默认允许的 CORS origin。GitHub OAuth 的本地与生产 callback、homepage 均从 `server/config/github-oauth.local.json` 读取：

```bash
cd /Users/zu/Desktop/Code/previte/NoteAI/server
pnpm start:dev
```

另开终端构建并启动 Simulator：

```bash
cd /Users/zu/Desktop/Code/previte/NoteAI/ios-capacitor
pnpm ios:sync
pnpm ios:open
```

在 Xcode 的 `App` Scheme 选择 iOS Simulator 后运行。`ios:open` 会打开生成的 `ios/App/App.xcworkspace`。也可以执行无签名编译检查：

```bash
pnpm ios:build:simulator
```

## 真机测试（生产 API）

真机使用线上 HTTPS 服务，不使用 `127.0.0.1`。先打入生产 API 地址，再在 Xcode 连接已开启开发者模式的 iPhone，设置 Development Team，选择该设备并运行：

```bash
cd /Users/zu/Desktop/Code/previte/NoteAI/ios-capacitor
pnpm ios:sync:production
pnpm ios:open
```

`ios:sync:production` 会将 `https://note.wwenj.com` 写入独立打包副本。线上 API 必须允许 `capacitor://localhost` 的 CORS；当前已验证预检通过。

## Personal Team 签名

当前 iOS 工程不启用 Associated Domains，避免 Personal Team 无法生成 provisioning profile。用户访问仅由 App 内的 Authenticator 验证完成。

## 命令

- `pnpm ios:prepare`：构建 Web，复制到独立 `www/`，并注入 Simulator API 地址。
- `pnpm ios:prepare:production`：构建 Web 并注入 `https://note.wwenj.com`。
- `pnpm ios:sync`：执行 prepare 后同步 Web 包和 iOS 原生依赖。
- `pnpm ios:sync:production`：同步使用生产 API 的 iOS 包，供真机测试。
- `pnpm ios:assets`：从 `assets/icon-only.png` 生成 iOS AppIcon。
- `pnpm ios:open`：打开 `ios/App/App.xcworkspace`。
- `pnpm ios:build:simulator`：同步后通过 `xcodebuild` 编译 Simulator 目标。
