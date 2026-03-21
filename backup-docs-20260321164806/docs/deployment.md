# 部署与运维

## 已安装 Node 后可用命令

| 目标 | 命令 | 说明 |
|---|---|---|
| 一键部署 | `node scripts/deploy.mjs deploy` | 默认清洁安装后再安装依赖并编译 |
| 一键更新升级 | `node scripts/deploy.mjs upgrade` | 默认清洁升级：先拆卸清理，再拉取并重新部署 |
| 安装/升级 OpenCode | `node scripts/deploy.mjs opencode-install` | 执行 `npm i -g opencode-ai` |
| 检查 OpenCode 环境 | `node scripts/deploy.mjs opencode-check` | 检查 opencode 命令与端口监听 |
| 启动 OpenCode CLI | `node scripts/deploy.mjs opencode-start` | 自动写入 `opencode.json` 后前台执行 `opencode` |
| 首次引导 | `node scripts/deploy.mjs guide` | 安装/部署/引导启动的一体化流程 |
| 管理菜单 | `npm run manage:bridge` | 交互式菜单（默认入口） |
| 启动后台 | `npm run start` | 后台启动（自动检测/补构建） |
| 停止后台 | `node scripts/stop.mjs` | 按 PID 停止后台进程 |

**注意**：菜单内已包含 OpenCode 的安装/检查/启动与首次引导，部署时会额外给出 OpenCode 安装与端口检查强提示（不阻断部署）。

## Web 配置面板

### 访问配置面板

服务启动后，通过浏览器访问：

```
http://localhost:4098
```

### 面板功能

- **配置管理**：实时修改飞书、Discord、OpenCode、可靠性等所有配置参数
- **Cron 任务**：创建、启用/禁用、删除定时任务
- **服务状态**：查看运行时长、版本、数据库路径
- **模型列表**：获取 OpenCode 可用模型
- **服务控制**：远程重启服务

### 访问密码

访问密码存储在 `.env` 文件的 `ADMIN_PASSWORD` 字段：

- 首次启动时自动生成随机密码
- 可手动修改 `.env` 文件更改密码
- 若 `ADMIN_PASSWORD` 为空，则无需密码即可访问

### 配置存储

配置参数存储在 SQLite 数据库中：

- 数据库路径：`data/config.db`
- 首次启动时自动从 `.env` 迁移
- 原 `.env` 备份为 `.env.backup`

## Linux 常驻（systemd）

管理菜单内提供以下操作：

- 安装并启动 systemd 服务
- 停止并禁用 systemd 服务
- 卸载 systemd 服务
- 查看运行状态

日志默认在 `logs/service.log` 和 `logs/service.err`。

## npm CLI 安装（更适合本地常驻运行场景）

```bash
npm install -g opencode-bridge
opencode-bridge
```

**说明**：
- npm 包主要提供 CLI 分发与版本管理便利，不替代 OpenCode 本地服务与飞书/Discord 配置。
- 运行后通过 Web 配置面板（`http://localhost:4098`）完成业务配置。
- CLI 默认优先读取当前工作目录下的 `.env`；若当前目录没有 `.env`，会自动回退读取 `~/.config/opencode-bridge/.env`。
- 你也可以显式指定配置目录：`opencode-bridge --config-dir /path/to/config`。
- 若你偏好源码部署，继续使用仓库里的 `scripts/deploy.*` / `scripts/start.*` 也完全没问题。

## npm CLI 配置方式

```bash
mkdir -p ~/.config/opencode-bridge

# 若你是通过 npm 全局安装：
cp "$(npm root -g)/opencode-bridge/.env.example" ~/.config/opencode-bridge/.env

# 若你是源码仓库内运行：
# cp .env.example ~/.config/opencode-bridge/.env

# 直接使用默认配置目录启动
opencode-bridge

# 启动后访问 http://localhost:4098 进入配置面板

# 或者在当前目录放独立 .env
mkdir -p ~/opencode-bridge-prod
cp .env.example ~/opencode-bridge-prod/.env
cd ~/opencode-bridge-prod
opencode-bridge

# 也可以显式指定配置目录
opencode-bridge --config-dir ~/.config/opencode-bridge
```

## 配置文件说明

### .env 文件（启动参数）

v2.9.2-beta 版本后，`.env` 文件仅存储 Admin 面板的启动参数：

```dotenv
# Admin 面板端口（默认 4098）
ADMIN_PORT=4098

# Admin 面板访问密码（留空则无需密码）
ADMIN_PASSWORD=your-admin-password
```

### SQLite 数据库（业务配置）

所有业务配置存储在 SQLite 数据库中：

- **数据库路径**：`data/config.db`
- **首次迁移**：启动时自动从 `.env` 迁移业务配置
- **备份位置**：原 `.env` 备份为 `.env.backup`

### 配置修改方式

| 方式 | 说明 |
|---|---|
| Web 面板 | 访问 `http://localhost:4098` 可视化修改 |
| SQLite 工具 | 直接编辑 `data/config.db` 数据库 |
| 配置文件 | 首次启动前在 `.env` 中配置（会自动迁移） |
