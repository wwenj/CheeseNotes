# iOS 客户端

## 技术架构

- **UI 层**：使用 SwiftUI。`MyNoteApp.swift` 是应用入口，`RootView.swift` 负责笔记、搜索、同步、设置等页面和导航。
- **数据层**：使用 SwiftData 保存 `CachedNote` 本地缓存；服务地址通过 `UserDefaults` 保存。
- **网络层**：`APIClient.swift` 使用 `URLSession` 发起请求，并通过 `actor` 保证客户端状态访问安全。服务地址由设置页配置，API 路径统一以 `api/` 开头。
- **工程管理**：使用 XcodeGen，根据 `project.yml` 生成 `NoteAI.xcodeproj`。最低部署版本为 iOS 17.0，Bundle ID 为 `com.wwenj.mynote`。

基本数据流：

```text
SwiftUI View
    ↓
APIClient（URLSession + UserDefaults）
    ↓ HTTP
远程或本地 HTTP API
```

## 项目启动

### 打开 iOS 工程

首次使用或修改了 `project.yml` 后重新生成工程：

```bash
cd /Users/zu/Desktop/Code/previte/NoteAI/ios
xcodegen generate
open NoteAI.xcodeproj
```

如果只修改 Swift 代码，不需要重复执行 `xcodegen generate`，直接打开现有的 `NoteAI.xcodeproj` 即可。

## 本地调试

1. 在 Xcode 中选择 `NoteAI` Scheme 和一个 iOS Simulator。
2. 按 `⌘R` 运行。
3. 在 App 的「设置」中填写可访问的 API 地址，例如：

   ```text
   http://127.0.0.1:3000
   ```

不要填写 `/api`，客户端会自动拼接 API 路径。

也可以只执行编译检查：

```bash
cd /Users/zu/Desktop/Code/previte/NoteAI
xcodebuild \
  -project ios/NoteAI.xcodeproj \
  -scheme NoteAI \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

代码断点、运行日志和网络错误可以直接在 Xcode 的 Debug Area 查看。

## 真机调试

1. 使用 USB 连接 iPhone，或在 Xcode 中配置无线调试。
2. 在 iPhone 开启「设置 → 隐私与安全性 → 开发者模式」，并信任当前 Mac。
3. 在 Xcode 中选择连接的 iPhone。
4. 打开 `NoteAI` Target → `Signing & Capabilities`，启用自动签名并选择 Apple Development Team。
5. 按 `⌘R` 安装并运行。

当前工程没有预设 `DEVELOPMENT_TEAM`，首次真机运行需要在 Xcode 中手动选择 Team。设备系统版本必须为 iOS 17 或更高。

真机不能使用 `127.0.0.1` 或 `localhost`。Mac 和 iPhone 需要处于同一局域网，在 App 设置中填写 Mac 的局域网 IP，例如：

```text
http://10.35.90.223:3000
```

如果无法连接，先用 iPhone Safari 打开：

```text
http://10.35.90.223:3000/api/health
```

同时检查 Mac 防火墙和局域网连接。当前 `Info.plist` 已允许本地 HTTP 网络访问。

## 测试与验证

当前 iOS 工程只有 `NoteAI` 应用 Target，没有单独的 XCTest Target，因此主要使用以下方式验证：

- **编译验证**：使用上面的 `xcodebuild ... build` 检查 Swift 编译和工程配置。
- **模拟器验证**：在 Simulator 中运行 App，设置 API 地址为 `http://127.0.0.1:3000`，验证页面加载、笔记列表、详情、编辑和同步操作。
- **真机验证**：设置 API 地址为 Mac 的局域网 IP，验证网络访问、页面加载、笔记读写和同步操作。

涉及 UI 的问题优先使用 Xcode Simulator 或真机手动复现，并结合 Xcode 控制台和断点定位；不使用复杂的自动化视觉测试。
