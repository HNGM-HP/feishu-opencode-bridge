# 发行说明：v2.9.51

**发布日期**: 2026-03-24

---

## 概述

v2.9.51 是一个功能增强版本，主要新增了钉钉平台支持，并增加了配置导入/导出功能，同时进行了多项 Bug 修复和架构优化。

---

## 核心特性

### 1. 钉钉平台支持

新增对钉钉企业平台的完整支持：

| 能力 | 状态 |
|------|------|
| 文本交互 | ✅ 完整支持 |
| 卡片消息 | ✅ 完整支持 |
| Stream 模式 | ✅ 完整支持 |
| 多账号管理 | ✅ 完整支持 |

**新增文件**：
- `src/handlers/dingtalk.ts` - 钉钉消息处理器
- `src/platform/adapters/dingtalk/` - 钉钉适配器目录
  - `dingtalk-adapter.ts` - 平台适配器
  - `dingtalk-card.ts` - 卡片消息构建器
  - `dingtalk-connection.ts` - 连接管理
  - `dingtalk-ids.ts` - ID 工具函数
  - `dingtalk-sender.ts` - 消息发送器
  - `dingtalk-types.ts` - TypeScript 类型定义

**配置项**：
```env
DINGTALK_ENABLED=true
DINGTALK_ACCOUNT_ID=你的账号 ID
DINGTALK_CLIENT_ID=你的客户端 ID
DINGTALK_CLIENT_SECRET=你的客户端密钥
```

### 2. 配置导入/导出功能

新增 Web 管理面板配置导入/导出功能：

- **导出配置**：将当前配置导出为 JSON 文件
- **导入配置**：从 JSON 文件导入配置
- **批量部署**：支持多服务器配置快速同步

**涉及文件**：
- `src/admin/admin-server.ts` - 新增导入/导出 API 端点
- `src/store/config-store.ts` - 配置存储层支持
- `web/src/api/index.ts` - 前端 API 封装
- `web/src/components/ConfigActionBar.vue` - 前端操作栏组件

---

## Bug 修复

| 问题 | 状态 |
|------|------|
| QQ 适配器连接稳定性 | ✅ 已修复 |
| WhatsApp 适配器连接逻辑 | ✅ 已修复 |
| 平台注册中心逻辑 | ✅ 已修复 |

---

## 架构优化

| 优化项 | 行为变化 | 状态 |
|--------|----------|------|
| 镜像脚本重构 | 新增 `scripts/setup-mirror.mjs` | ✅ |
| 配置模块增强 | 支持配置导入/导出 | ✅ |
| 平台注册中心 | 支持动态注册 | ✅ |
| QQ 适配器 | 优化连接逻辑 | ✅ |
| WhatsApp 适配器 | 优化连接逻辑 | ✅ |

---

## 主要涉及文件

```
src/
├── admin/
│   └── admin-server.ts           # 新增配置导入/导出 API
├── config/
│   ├── migrator.ts               # 配置迁移增强
│   └── platform.ts               # 平台配置增强
├── handlers/
│   ├── dingtalk.ts               # 新增：钉钉消息处理
│   └── platform-command.handler.ts
├── platform/
│   ├── adapters/
│   │   ├── dingtalk/             # 新增：钉钉适配器目录
│   │   │   ├── dingtalk-adapter.ts
│   │   │   ├── dingtalk-card.ts
│   │   │   ├── dingtalk-connection.ts
│   │   │   ├── dingtalk-ids.ts
│   │   │   ├── dingtalk-sender.ts
│   │   │   └── dingtalk-types.ts
│   │   ├── qq-adapter.ts         # 优化
│   │   └── whatsapp-adapter.ts   # 优化
│   ├── registry.ts               # 平台注册中心
│   └── types.ts                  # 平台类型定义
└── store/
    └── config-store.ts           # 配置存储增强

web/
├── src/api/index.ts              # 新增钉钉 API
└── src/views/Platforms.vue       # 平台配置页面增强

assets/docs/
├── dingtalk-config.md            # 新增：钉钉配置指南
└── dingtalk-config-en.md         # 新增：钉钉配置指南 (英文)

scripts/
└── setup-mirror.mjs              # 新增：镜像源设置脚本
```

---

## 升级指南

### 升级步骤

```bash
# 1. 停止服务
npm run stop

# 2. 拉取最新代码或更新 NPM 包
git pull origin beta
# 或
npm install opencode-bridge@2.9.51

# 3. 安装依赖
npm install

# 4. 重启服务
npm run start
```

### 配置钉钉平台

1. 访问 `http://localhost:4098` 进入配置面板
2. 在「平台配置」中找到钉钉
3. 填写钉钉应用凭证：
   - 账号 ID (AccountId)
   - 客户端 ID (ClientId)
   - 客户端密钥 (ClientSecret)
4. 保存并重启服务

---

## 注意事项

1. **钉钉应用类型**：必须创建「企业内部应用」
2. **消息接收模式**：必须选择「Stream 模式」
3. **管理员权限**：需要钉钉企业管理员权限
4. **配置导入/导出**：导出的配置文件包含敏感信息，请妥善保管

---

## 统计

| 指标 | 数值 |
|------|------|
| 新增平台 | 1 (钉钉) |
| 新增文件 | 9 (钉钉适配器 + 文档) |
| 修改文件 | 10+ |
| 新增 API | 2 (配置导入/导出) |
| 代码行数 | +3,776 / -3,171 |

---

## 版本历史

| 阶段 | 版本 | 主要贡献 |
|------|------|----------|
| 起点 | v2.9.3-beta | Web 可视化配置中心发布 |
| 功能扩展 | v2.9.4-beta | 架构优化与可靠性增强 |
| 多平台扩展 | v2.9.5 | 新增 5 个平台支持 |
| **当前** | **v2.9.51** | 钉钉平台支持与配置导入/导出 |
