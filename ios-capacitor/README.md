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

先启动后端。Capacitor 内置 WebView 的 `capacitor://localhost` 已是服务端默认允许的 CORS origin，GitHub callback 也已默认使用本机服务地址；只需指定 OAuth 成功后回跳 App：

```bash
cd /Users/zu/Desktop/Code/previte/NoteAI/server
WEB_ORIGIN=capacitor://localhost pnpm start:dev
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

## 命令

- `pnpm ios:prepare`：构建 Web，复制到独立 `www/`，并注入 Simulator API 地址。
- `pnpm ios:sync`：执行 prepare 后同步 Web 包和 iOS 原生依赖。
- `pnpm ios:assets`：从 `assets/icon-only.png` 生成 iOS AppIcon。
- `pnpm ios:open`：打开 `ios/App/App.xcworkspace`。
- `pnpm ios:build:simulator`：同步后通过 `xcodebuild` 编译 Simulator 目标。
