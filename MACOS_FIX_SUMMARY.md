# macOS 打包问题修复总结

## 问题描述
在 macOS 上运行打包后的 Electron 应用时，出现以下错误：
```
Error: Cannot find module '/Applications/OpenCode Bridge.app/Contents/Resources/app.asar/dist/admin/index.js'
```

## 根本原因

**路径解析错误**：在 `electron/main.ts` 中，`startBackend()` 函数使用了错误的路径来定位后端服务文件：

```typescript
// ❌ 错误的代码（已修复）
const appPath = isDev ? path.resolve(__dirname, '..') : app.getAppPath();
const backendPath = path.join(appPath, 'dist/admin/index.js');
```

**问题分析**：
1. `app.getAppPath()` 在打包后返回 `app.asar` 的路径
2. 但在 `package.json` 的 `extraResources` 配置中，`dist` 目录被复制到 `app.asar` 外部的 `app/dist/` 目录
3. 因此实际文件路径应该是：`/Applications/OpenCode Bridge.app/Contents/Resources/app/dist/admin/index.js`

## 解决方案

修改 `electron/main.ts` 的 `startBackend()` 函数，使用 `process.resourcesPath` 访问 extraResources 复制的文件：

```typescript
// ✅ 修复后的代码
let backendPath: string;
if (isDev) {
  backendPath = path.resolve(__dirname, '../dist/admin/index.js');
} else {
  // macOS: /Applications/OpenCode Bridge.app/Contents/Resources/app/dist/admin/index.js
  // Windows: C:\Program Files\OpenCode Bridge\resources\app\dist\admin\index.js
  // Linux: /opt/opencode-bridge/resources/app/dist/admin/index.js
  backendPath = path.join(process.resourcesPath, 'app', 'dist', 'admin', 'index.js');
}
```

## 修复的文件

- `electron/main.ts` - 修复了后端服务路径解析

## 重新打包应用

修复后，需要重新构建和打包应用：

```bash
# 1. 重新编译 Electron TypeScript 代码
npm run build:electron

# 2. 构建 Web 前端（如果需要）
npm run build:web

# 3. 重新打包应用
npm run dist:mac    # macOS
# 或
npm run dist:win    # Windows
# 或
npm run dist:linux  # Linux
```

## 验证修复

打包后的应用应该能够正常启动后端服务，不再出现 `MODULE_NOT_FOUND` 错误。

## 技术细节

### Electron 打包后的目录结构

```
/Applications/OpenCode Bridge.app/Contents/
├── Info.plist
├── MacOS/
│   └── OpenCode Bridge          # 可执行文件
└── Resources/
    ├── app.asar                  # 主应用代码（由 build.files 打包）
    ├── app/
    │   ├── dist/                 # extraResources 复制的文件
    │   │   └── admin/
    │   │       └── index.js      # ← 后端服务入口
    │   ├── assets/               # 额外资源
    │   └── scripts/              # 脚本文件
    └── ...                       # 其他资源
```

### 关键 API 区别

- `app.getAppPath()` - 返回 `app.asar` 的路径
- `process.resourcesPath` - 返回 `Resources` 目录的路径，可以访问 extraResources 复制的文件

## 版本信息

- 修复版本：3.0.2+
- 修复日期：2026-04-21
