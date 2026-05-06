# 配置中心

> **架构变更说明**：业务配置参数已迁移至 SQLite 数据库存储，通过 Web 可视化面板管理。`.env` 文件仅用于存储 Admin 面板的启动参数，不再作为业务配置文件使用。

---

## 配置管理方式

### 方式一：Web 可视化面板（推荐）

服务启动后，访问 `http://localhost:4098` 进入配置面板：

- ✅ 实时修改所有配置参数
- ✅ 管理 Cron 定时任务
- ✅ 查看服务运行状态
- ✅ 敏感字段自动脱敏显示
- ✅ 平台连接状态查看

### 方式二：SQLite 数据库

配置存储在 `data/config.db` 数据库中，可通过数据库工具直接查看或修改。

### 方式三：.env 文件（仅启动参数）

`.env` 文件现在只存储 Admin 面板的启动参数：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `ADMIN_PORT` | 否 | `4098` | Web 配置面板监听端口 |
| `ADMIN_PASSWORD` | 否 | 无 | Web 配置面板访问密码，首次访问时设置 |

---

## 业务配置参数

以下参数通过 Web 面板配置，或首次启动时从 `.env` 自动迁移至数据库：

### 基础配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `FEISHU_ENABLED` | 否 | `false` | 是否启用飞书适配器 |
| `FEISHU_APP_ID` | 条件 | - | 飞书应用 App ID（启用飞书时必填） |
| `FEISHU_APP_SECRET` | 条件 | - | 飞书应用 App Secret |
| `FEISHU_ENCRYPT_KEY` | 条件 | - | 飞书应用 Encrypt Key |
| `FEISHU_VERIFICATION_TOKEN` | 条件 | - | 飞书应用 Verification Token |
| `ROUTER_MODE` | 否 | `legacy` | 路由模式：`legacy`（经典）/ `dual`（双轨）/ `router`（新版） |
| `ENABLED_PLATFORMS` | 否 | - | 平台白名单，逗号分隔（如 `feishu,discord,wecom`） |
| `GROUP_REQUIRE_MENTION` | 否 | `false` | 为 `true` 时，群聊仅在明确 @ 机器人时响应 |
| `OPENCODE_HOST` | 否 | `localhost` | OpenCode 服务器地址 |
| `OPENCODE_PORT` | 否 | `4096` | OpenCode 服务器端口 |
| `OPENCODE_AUTO_START` | 否 | `true` | 设置为 `true` 时，Bridge 启动时自动启动 OpenCode |
| `OPENCODE_AUTO_START_CMD` | 否 | `opencode serve` | 自定义 OpenCode 启动命令 |

### Discord 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `DISCORD_ENABLED` | 否 | `false` | 是否启用 Discord 适配器 |
| `DISCORD_TOKEN` | 条件 | - | Discord Bot Token（启用 Discord 时必填） |
| `DISCORD_BOT_TOKEN` | 条件 | - | Discord Bot Token（兼容别名） |
| `DISCORD_CLIENT_ID` | 否 | - | Discord 应用 Client ID |

### 企业微信配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `WECOM_ENABLED` | 否 | `false` | 是否启用企业微信适配器 |
| `WECOM_BOT_ID` | 条件 | - | 企业微信 Bot ID（启用企业微信时必填） |
| `WECOM_SECRET` | 条件 | - | 企业微信 Secret |

### Telegram 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `TELEGRAM_ENABLED` | 否 | `false` | 是否启用 Telegram 适配器 |
| `TELEGRAM_BOT_TOKEN` | 条件 | - | Telegram Bot Token（启用 Telegram 时必填） |

### QQ 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `QQ_ENABLED` | 否 | `false` | 是否启用 QQ 适配器 |
| `QQ_PROTOCOL` | 否 | `onebot` | 协议类型：`official`（官方）或 `onebot`（社区） |
| `QQ_APP_ID` | 条件 | - | 官方协议：QQ 机器人 App ID |
| `QQ_SECRET` | 条件 | - | 官方协议：QQ 机器人 Secret |
| `QQ_CALLBACK_URL` | 条件 | - | 官方协议：Webhook 回调地址 |
| `QQ_ENCRYPT_KEY` | 条件 | - | 官方协议：消息加密密钥 |
| `QQ_ONEBOT_WS_URL` | 条件 | - | OneBot 协议：WebSocket 地址 |
| `QQ_ONEBOT_HTTP_URL` | 条件 | - | OneBot 协议：HTTP API 地址 |

### WhatsApp 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `WHATSAPP_ENABLED` | 否 | `false` | 是否启用 WhatsApp 适配器 |
| `WHATSAPP_MODE` | 否 | `personal` | 运行模式：`personal`（个人号）或 `business`（商业号） |
| `WHATSAPP_SESSION_PATH` | 否 | `data/whatsapp-session` | Personal 模式：会话文件存储路径 |
| `WHATSAPP_BUSINESS_PHONE_ID` | 条件 | - | Business 模式：Phone ID |
| `WHATSAPP_BUSINESS_ACCESS_TOKEN` | 条件 | - | Business 模式：Access Token |
| `WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN` | 条件 | - | Business 模式：Webhook 验证 Token |

### 微信个人号配置

微信个人号通过数据库配置，不使用环境变量。详见 [微信个人号配置指南](weixin-config.md)。

### 认证与权限

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `OPENCODE_SERVER_USERNAME` | 否 | `opencode` | OpenCode Server Basic Auth 用户名 |
| `OPENCODE_SERVER_PASSWORD` | 否 | - | OpenCode Server Basic Auth 密码 |
| `ALLOWED_USERS` | 否 | - | 飞书 open_id 白名单，逗号分隔；为空时不启用白名单 |
| `ENABLE_MANUAL_SESSION_BIND` | 否 | `true` | 是否允许"绑定已有 OpenCode 会话" |
| `TOOL_WHITELIST` | 否 | `Read,Glob,Grep,Task` | 自动放行权限标识列表 |

### 输出与资源

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `PERMISSION_REQUEST_TIMEOUT_MS` | 否 | `0` | 权限请求保留时长（毫秒）；`<=0` 表示不超时 |
| `OUTPUT_UPDATE_INTERVAL` | 否 | `3000` | 输出刷新间隔（ms） |
| `ATTACHMENT_MAX_SIZE` | 否 | `52428800` | 附件大小上限（字节，默认 50MB） |

### 工作目录与项目

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `ALLOWED_DIRECTORIES` | 否 | - | 允许的工作目录根列表，逗号分隔；未配置时禁止用户自定义路径 |
| `DEFAULT_WORK_DIRECTORY` | 否 | - | 全局默认工作目录（最低优先级兜底） |
| `PROJECT_ALIASES` | 否 | `{}` | 项目别名 JSON 映射（如 `{"fe":"/home/user/fe"}`） |
| `GIT_ROOT_NORMALIZATION` | 否 | `true` | 是否自动将目录归一到 Git 仓库根目录 |

### 显示控制

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `SHOW_THINKING_CHAIN` | 否 | `true` | 全局默认：是否显示 AI 思维链 |
| `SHOW_TOOL_CHAIN` | 否 | `true` | 全局默认：是否显示工具调用链 |
| `FEISHU_SHOW_THINKING_CHAIN` | 否 | - | 飞书专用：覆盖全局 `SHOW_THINKING_CHAIN` |
| `FEISHU_SHOW_TOOL_CHAIN` | 否 | - | 飞书专用：覆盖全局 `SHOW_TOOL_CHAIN` |
| `DISCORD_SHOW_THINKING_CHAIN` | 否 | - | Discord 专用：覆盖全局 `SHOW_THINKING_CHAIN` |
| `DISCORD_SHOW_TOOL_CHAIN` | 否 | - | Discord 专用：覆盖全局 `SHOW_TOOL_CHAIN` |
| `WECOM_SHOW_THINKING_CHAIN` | 否 | - | 企业微信专用：覆盖全局 `SHOW_THINKING_CHAIN` |
| `WECOM_SHOW_TOOL_CHAIN` | 否 | - | 企业微信专用：覆盖全局 `SHOW_TOOL_CHAIN` |

### 可靠性 Cron

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `RELIABILITY_CRON_ENABLED` | 否 | `true` | 是否启用可靠性 Cron 调度器 |
| `RELIABILITY_CRON_API_ENABLED` | 否 | `false` | 是否启用运行时 Cron HTTP API |
| `RELIABILITY_CRON_API_HOST` | 否 | `127.0.0.1` | Cron API 监听地址 |
| `RELIABILITY_CRON_API_PORT` | 否 | `4097` | Cron API 监听端口 |
| `RELIABILITY_CRON_API_TOKEN` | 否 | - | Cron API Bearer Token（启用后请求需带 Authorization 头） |
| `RELIABILITY_CRON_JOBS_FILE` | 否 | `~/cron/jobs.json` | 运行时 Cron 任务持久化文件 |
| `RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP` | 否 | `false` | 是否自动清理僵尸 Cron |
| `RELIABILITY_CRON_FORWARD_TO_PRIVATE` | 否 | `false` | 原聊天窗口失效时，是否允许转发到私聊 |
| `RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID` | 否 | - | 飞书备用接收 chat_id |
| `RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID` | 否 | - | Discord 备用接收频道/私聊 conversationId |
| `RELIABILITY_CRON_FALLBACK_WECOM_CONVERSATION_ID` | 否 | - | 企业微信备用接收 conversationId |

### 心跳配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED` | 否 | `false` | 是否启用 Bridge 主动心跳定时器 |
| `RELIABILITY_INBOUND_HEARTBEAT_ENABLED` | 否 | `false` | 是否启用"入站消息触发心跳"（兼容模式） |
| `RELIABILITY_HEARTBEAT_INTERVAL_MS` | 否 | `1800000` | Bridge 主动心跳轮询间隔（毫秒，默认 30 分钟） |
| `RELIABILITY_HEARTBEAT_AGENT` | 否 | - | 主动心跳发送到 OpenCode 时使用的 agent |
| `RELIABILITY_HEARTBEAT_PROMPT` | 否 | 内置默认提示 | 主动心跳提示词 |
| `RELIABILITY_HEARTBEAT_ALERT_CHATS` | 否 | - | 心跳告警推送目标飞书 chat_id（逗号分隔） |

### 救援策略

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `RELIABILITY_FAILURE_THRESHOLD` | 否 | `3` | 触发自动救援所需的连续失败次数 |
| `RELIABILITY_WINDOW_MS` | 否 | `90000` | 失败统计窗口（毫秒，默认 90 秒） |
| `RELIABILITY_COOLDOWN_MS` | 否 | `300000` | 两次自动救援之间的冷却时间（毫秒，默认 5 分钟） |
| `RELIABILITY_REPAIR_BUDGET` | 否 | `3` | 自动救援预算（耗尽后转人工介入） |
| `RELIABILITY_MODE` | 否 | `observe` | 可靠性模式预留字段 |
| `RELIABILITY_LOOPBACK_ONLY` | 否 | `true` | 是否只允许对 `localhost/127.0.0.1/::1` 执行自动救援 |
| `OPENCODE_CONFIG_FILE` | 否 | `./opencode.json` | 宕机救援时用于备份与回退的 OpenCode 配置文件路径 |

---

## 配置说明

### `TOOL_WHITELIST` 说明

做字符串匹配，权限事件可能使用 `permission` 字段值（例如 `external_directory`），请按实际标识配置。

### 认证配置

如果 OpenCode 端开启了 `OPENCODE_SERVER_PASSWORD`，桥接端也必须配置同一组 `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`，否则会出现 401/403 认证失败。

### 模型策略

仅当 `DEFAULT_PROVIDER` 与 `DEFAULT_MODEL` 同时配置时，桥接才会显式指定模型；否则由 OpenCode 自身默认模型决定。

### `ALLOWED_USERS` 说明

- **未配置或留空**：不启用白名单；生命周期清理仅在群成员数为 `0` 时才会自动解散群聊
- **已配置**：启用白名单保护；当群成员不足且群内/群主都不在白名单时，才会自动解散

### `ENABLE_MANUAL_SESSION_BIND` 取值语义

- `true`：允许 `/session <sessionId>`，且建群卡片可选择"绑定已有会话"
- `false`：禁用手动绑定能力；建群卡片仅保留"新建会话"

### `ALLOWED_DIRECTORIES` 说明

- **未配置或留空**：禁止用户通过 `/session new <path>` 自定义路径；仅允许使用默认目录、项目别名或从已知项目列表选择
- **已配置**：用户输入的路径经规范化与 realpath 解析后，必须落在允许根目录之下（含子目录），否则拒绝
- 多个根目录用逗号分隔，如 `ALLOWED_DIRECTORIES=/home/user/projects,/opt/repos`
- Windows 系统支持 Windows 格式路径，可使用正斜杠 `/` 或反斜杠 `\` 作为路径分隔符

### `PROJECT_ALIASES` 说明

- JSON 格式映射短名到绝对路径，如 `{"frontend":"/home/user/frontend"}`
- 用户可通过 `/session new frontend` 使用别名创建会话，无需记忆完整路径
- 别名路径同样受 `ALLOWED_DIRECTORIES` 约束

---

## 配置迁移说明

### 首次启动迁移

首次启动时，系统会自动执行：

1. 检测 `.env` 文件中的业务配置
2. 将配置写入 SQLite 数据库（`data/config.db`）
3. 标记迁移完成
4. 原 `.env` 备份为 `.env.backup`

### 配置生效规则

| 配置类型 | 修改后生效方式 |
|---|---|
| 显示控制（SHOW_*） | 立即生效 |
| 白名单（ALLOWED_*） | 立即生效 |
| 飞书配置（FEISHU_*） | 需重启服务 |
| Discord 配置（DISCORD_*） | 需重启服务 |
| 企业微信配置（WECOM_*） | 需重启服务 |
| OpenCode 连接（OPENCODE_HOST/PORT） | 需重启服务 |
| 可靠性开关（RELIABILITY_*） | 需重启服务 |

---

## Web 面板 API

配置面板提供以下 API 接口：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/config` | GET | 获取当前配置（敏感字段脱敏） |
| `/api/config` | POST | 保存配置 |
| `/api/cron` | GET | 列出所有 Cron 任务 |
| `/api/cron/create` | POST | 创建 Cron 任务 |
| `/api/cron/:id/toggle` | POST | 启用/禁用任务 |
| `/api/cron/:id` | DELETE | 删除任务 |
| `/api/admin/status` | GET | 获取服务状态 |
| `/api/admin/restart` | POST | 重启服务 |
| `/api/opencode/models` | GET | 获取 OpenCode 可用模型 |
| `/api/opencode/status` | GET | 获取 OpenCode 状态 |
| `/api/opencode/install` | POST | 安装/升级 OpenCode |
| `/api/opencode/start` | POST | 启动 OpenCode CLI |
