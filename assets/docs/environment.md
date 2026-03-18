# 环境变量配置

以 `src/config.ts` 与 `src/index.ts` 实际读取为准：

## 基础配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `FEISHU_APP_ID` | 是 | - | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是 | - | 飞书应用 App Secret |
| `ROUTER_MODE` | 否 | `legacy` | 路由模式：`legacy`/`dual`/`router` |
| `ENABLED_PLATFORMS` | 否 | - | 平台白名单，逗号分隔（如 `feishu,discord`） |
| `GROUP_REQUIRE_MENTION` | 否 | `false` | 为 `true` 时，群聊仅在明确 @ 机器人时响应 |
| `OPENCODE_HOST` | 否 | `localhost` | OpenCode 地址 |
| `OPENCODE_PORT` | 否 | `4096` | OpenCode 端口 |
| `OPENCODE_AUTO_START` | 否 | `false` | 设置为 `true` 时，Bridge 启动时会自动启动 OpenCode 后台进程 |
| `OPENCODE_AUTO_START_CMD` | 否 | `opencode serve` | 自定义 OpenCode 启动命令（默认为 headless 后台模式） |

## Discord 配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `DISCORD_ENABLED` | 否 | `false` | 是否启用 Discord 适配器 |
| `DISCORD_TOKEN` | 否 | - | Discord Bot Token（优先） |
| `DISCORD_BOT_TOKEN` | 否 | - | Discord Bot Token（兼容别名） |
| `DISCORD_CLIENT_ID` | 否 | - | Discord 应用 Client ID |

## 认证与权限

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `OPENCODE_SERVER_USERNAME` | 否 | `opencode` | OpenCode Server Basic Auth 用户名 |
| `OPENCODE_SERVER_PASSWORD` | 否 | - | OpenCode Server Basic Auth 密码 |
| `ALLOWED_USERS` | 否 | - | 飞书 open_id 白名单，逗号分隔；为空时不启用白名单 |
| `ENABLE_MANUAL_SESSION_BIND` | 否 | `true` | 是否允许"绑定已有 OpenCode 会话"；关闭后仅允许新建会话 |
| `TOOL_WHITELIST` | 否 | `Read,Glob,Grep,Task` | 自动放行权限标识列表 |

## 输出与资源

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `PERMISSION_REQUEST_TIMEOUT_MS` | 否 | `0` | 权限请求在桥接侧的保留时长（毫秒）；`<=0` 表示不超时，持续等待回复 |
| `OUTPUT_UPDATE_INTERVAL` | 否 | `3000` | 输出刷新间隔（ms） |
| `ATTACHMENT_MAX_SIZE` | 否 | `52428800` | 附件大小上限（字节） |

## 工作目录与项目

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `ALLOWED_DIRECTORIES` | 否 | - | 允许的工作目录根列表，逗号分隔绝对路径；未配置时禁止用户自定义路径，同时 `/send` 文件发送会直接拒绝 |
| `DEFAULT_WORK_DIRECTORY` | 否 | - | 全局默认工作目录（最低优先级兜底），不配置则跟随 OpenCode 服务端 |
| `PROJECT_ALIASES` | 否 | `{}` | 项目别名 JSON 映射（如 `{"fe":"/home/user/fe"}`），支持短名创建会话 |
| `GIT_ROOT_NORMALIZATION` | 否 | `true` | 是否自动将目录归一到 Git 仓库根目录 |

## 显示控制

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `SHOW_THINKING_CHAIN` | 否 | `true` | 全局默认：是否显示 AI 思维链（thinking 内容） |
| `SHOW_TOOL_CHAIN` | 否 | `true` | 全局默认：是否显示工具调用链 |
| `FEISHU_SHOW_THINKING_CHAIN` | 否 | - | 飞书专用：覆盖全局 `SHOW_THINKING_CHAIN`，未设置时继承全局值 |
| `FEISHU_SHOW_TOOL_CHAIN` | 否 | - | 飞书专用：覆盖全局 `SHOW_TOOL_CHAIN`，未设置时继承全局值 |
| `DISCORD_SHOW_THINKING_CHAIN` | 否 | - | Discord 专用：覆盖全局 `SHOW_THINKING_CHAIN`，未设置时继承全局值 |
| `DISCORD_SHOW_TOOL_CHAIN` | 否 | - | Discord 专用：覆盖全局 `SHOW_TOOL_CHAIN`，未设置时继承全局值 |

## 可靠性 Cron

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `RELIABILITY_CRON_ENABLED` | 否 | `true` | 是否启用可靠性 Cron 调度器 |
| `RELIABILITY_CRON_API_ENABLED` | 否 | `false` | 是否启用运行时 Cron HTTP API |
| `RELIABILITY_CRON_API_HOST` | 否 | `127.0.0.1` | Cron API 监听地址 |
| `RELIABILITY_CRON_API_PORT` | 否 | `4097` | Cron API 监听端口 |
| `RELIABILITY_CRON_API_TOKEN` | 否 | - | Cron API Bearer Token（启用后请求需带 Authorization 头） |
| `RELIABILITY_CRON_JOBS_FILE` | 否 | `~/cron/jobs.json` | 运行时 Cron 任务持久化文件 |
| `RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP` | 否 | `false` | 是否自动清理僵尸 Cron（启动扫描 / 群解散或频道删除联动 / stale cleanup） |
| `RELIABILITY_CRON_FORWARD_TO_PRIVATE` | 否 | `false` | 原聊天窗口失效时，是否允许转发到私聊或备用窗口 |
| `RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID` | 否 | - | Feishu 备用接收 chat_id |
| `RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID` | 否 | - | Discord 备用接收频道/私聊 conversationId |

## 心跳配置

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED` | 否 | `false` | 是否启用 Bridge 主动心跳定时器 |
| `RELIABILITY_INBOUND_HEARTBEAT_ENABLED` | 否 | `false` | 是否启用"入站消息触发心跳"（兼容模式） |
| `RELIABILITY_HEARTBEAT_INTERVAL_MS` | 否 | `1800000` | Bridge 主动心跳轮询间隔（毫秒） |
| `RELIABILITY_HEARTBEAT_AGENT` | 否 | - | 主动心跳发送到 OpenCode 时使用的 agent |
| `RELIABILITY_HEARTBEAT_PROMPT` | 否 | 内置默认提示 | 主动心跳提示词（建议包含 HEARTBEAT_OK 约定） |
| `RELIABILITY_HEARTBEAT_ALERT_CHATS` | 否 | - | 心跳告警推送目标飞书 chat_id（逗号分隔） |

## 救援策略

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `RELIABILITY_FAILURE_THRESHOLD` | 否 | `3` | 无限重连场景下，触发自动救援所需的连续失败次数 |
| `RELIABILITY_WINDOW_MS` | 否 | `90000` | 无限重连场景下，失败统计窗口（毫秒） |
| `RELIABILITY_COOLDOWN_MS` | 否 | `300000` | 两次自动救援之间的冷却时间（毫秒） |
| `RELIABILITY_REPAIR_BUDGET` | 否 | `3` | 自动救援预算（耗尽后转人工介入） |
| `RELIABILITY_MODE` | 否 | `observe` | 可靠性模式预留字段（当前版本以阈值/预算策略为准） |
| `RELIABILITY_LOOPBACK_ONLY` | 否 | `true` | 是否只允许对 `localhost/127.0.0.1/::1` 执行自动救援 |
| `OPENCODE_CONFIG_FILE` | 否 | `./opencode.json` | 宕机救援时用于备份与回退的 OpenCode 配置文件路径 |

## 注意事项

**`TOOL_WHITELIST` 说明**：做字符串匹配，权限事件可能使用 `permission` 字段值（例如 `external_directory`），请按实际标识配置。

**认证配置**：如果 OpenCode 端开启了 `OPENCODE_SERVER_PASSWORD`，桥接端也必须配置同一组 `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`，否则会出现 401/403 认证失败。

**模型策略**：仅当 `DEFAULT_PROVIDER` 与 `DEFAULT_MODEL` 同时配置时，桥接才会显式指定模型；否则由 OpenCode 自身默认模型决定。

**`ALLOWED_USERS` 说明**：
- 未配置或留空：不启用白名单；生命周期清理仅在群成员数为 `0` 时才会自动解散群聊。
- 已配置：启用白名单保护；当群成员不足且群内/群主都不在白名单时，才会自动解散。

**`ENABLE_MANUAL_SESSION_BIND` 取值语义**：
- `true`：允许 `/session <sessionId>`，且建群卡片可选择"绑定已有会话"。
- `false`：禁用手动绑定能力；建群卡片仅保留"新建会话"。

**`ALLOWED_DIRECTORIES` 说明**：
- 未配置或留空：禁止用户通过 `/session new <path>` 自定义路径；仅允许使用默认目录、项目别名或从已知项目列表选择。
- 已配置：用户输入的路径经规范化与 realpath 解析后，必须落在允许根目录之下（含子目录），否则拒绝。
- 多个根目录用逗号分隔，如 `ALLOWED_DIRECTORIES=/home/user/projects,/opt/repos`。
- Windows 系统支持 Windows 格式路径，可使用正斜杠 `/` 或反斜杠 `\` 作为路径分隔符。

**`PROJECT_ALIASES` 说明**：
- JSON 格式映射短名到绝对路径，如 `{"frontend":"/home/user/frontend"}`。
- 用户可通过 `/session new frontend` 使用别名创建会话，无需记忆完整路径。
- 别名路径同样受 `ALLOWED_DIRECTORIES` 约束。
