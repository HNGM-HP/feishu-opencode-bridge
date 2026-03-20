# 发行说明：v2.9.3-beta

**发布日期**: 2026-03-21

---

## 相比 v2.9.2-beta 的主要变更

### 🎯 核心特性

#### 1. Web 可视化配置中心（全新架构）

- **配置存储迁移**：配置参数由 `.env` 文件迁移至 SQLite 数据库存储
- **实时配置管理**：支持通过浏览器实时修改配置，无需手动编辑文件
- **配置类别**：
  - **核心路由**：路由器模式、平台启用控制
  - **平台配置**：飞书/Discord 凭据管理
  - **OpenCode**：模型、认证、服务端点配置
  - **可靠性**：心跳、救援、Cron 任务配置

#### 2. 配置管理后台

- 新增 Admin Server (`src/admin/admin-server.ts`)
- 新增 Web 前端 (`web/`)，基于 Vue 3 + Vite + Element Plus
- 支持配置热更新，修改后立即生效

#### 3. 数据库存储

- 新增 `ConfigStore` 配置存储模块
- 新增 `LogStore` 日志存储模块
- 自动迁移 `.env` 配置至数据库（首次启动）
- 原 `.env` 备份为 `.env.backup`

---

### 🔧 功能增强

#### Cron 任务管理
- 可视化创建、启用/禁用、删除定时任务
- 支持查看任务执行历史

#### 服务状态监控
- 查看运行时长、版本、数据库路径
- 获取 OpenCode 可用模型列表
- 远程重启服务

#### 日志系统升级
- 新增 `src/utils/logger.ts` 日志工具
- 支持日志持久化存储
- Web 端可查看实时日志

---

### 📦 技术架构变更

| 模块 | 变更前 | 变更后 |
|------|--------|--------|
| 配置源 | `.env` 文件 | SQLite (`data/config.db`) |
| `.env` 用途 | 全部业务配置 | 仅存储 `ADMIN_PORT` 和 `ADMIN_PASSWORD` |
| 前端框架 | 无 | Vue 3 + Vite + Element Plus |
| 后端接口 | 无 | 新增 REST API (`/api/*`) |

---

### 📁 新增文件

```
web/                          # 前端项目目录
├── src/
│   ├── views/
│   │   ├── Dashboard.vue     # 仪表盘
│   │   ├── Settings.vue      # 配置管理
│   │   ├── CronJobs.vue      # Cron 任务
│   │   ├── Platforms.vue     # 平台配置
│   │   ├── OpenCode.vue      # OpenCode 配置
│   │   ├── Reliability.vue   # 可靠性配置
│   │   ├── Logs.vue          # 日志查看
│   │   ├── Login.vue         # 登录页
│   │   └── ChangePassword.vue # 修改密码
│   ├── api/index.ts          # API 客户端
│   ├── stores/config.ts      # 配置状态
│   └── router/index.ts       # 前端路由
├── package.json
├── vite.config.ts
└── tsconfig.json

src/admin/
├── admin-server.ts           # Admin 服务主逻辑
└── bridge-manager.ts         # 桥接服务管理

src/store/
├── config-store.ts           # 配置存储
└── log-store.ts              # 日志存储
```

---

### 🚀 升级指南

#### 升级步骤

```bash
# 1. 拉取最新代码
git pull origin beta

# 2. 安装依赖
npm install

# 3. 构建 Web 前端
cd web && pnpm install && pnpm build

# 4. 重启服务
npm run start
```

#### 首次启动

- 系统自动执行配置迁移
- 访问 `http://localhost:4098` 进入配置面板
- 使用 `.env` 中的 `ADMIN_PASSWORD` 登录

---

### ⚠️ 注意事项

1. **备份建议**：升级前建议备份 `.env` 文件和 `data/` 目录
2. **端口检查**：确保 `ADMIN_PORT` (默认 4098) 未被占用
3. **权限要求**：首次启动需要数据库写入权限
4. **配置迁移**：首次启动时原 `.env` 配置会自动迁移至数据库

---

### 📊 统计

| 指标 | 数值 |
|------|------|
| 新增文件 | 33+ |
| 修改文件 | 39+ |
| 新增代码行 | ~5800+ |
| 涉及模块 | Admin, Web, Store, Config, Router, Reliability |

---

### 📝 版本历史

- **v2.9.3-beta** (2026-03-21) - Web 可视化配置中心
- **v2.9.2-beta** - 架构优化与可靠性增强
