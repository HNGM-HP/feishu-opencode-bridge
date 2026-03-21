# 故障排查指南

## 飞书相关

| 现象 | 优先检查 |
|---|---|
| 飞书发送消息后 OpenCode 无反应 | 仔细检查飞书权限；确认 [飞书后台配置](feishu-config.md) 正确 |
| 点权限卡片后 OpenCode 无反应 | 日志是否出现权限回传失败；确认回传值是 `once/always/reject` |
| 权限卡或提问卡发不到群 | `.chat-sessions.json` 中 `sessionId -> chatId` 映射是否存在 |
| 卡片更新失败 | 消息类型是否匹配；失败后是否降级为重发卡片 |

## Discord 相关

| 现象 | 优先检查 |
|---|---|
| Discord 发送消息后 OpenCode 无反应 | 检查 `DISCORD_ENABLED` 是否为 `true`；检查 `DISCORD_TOKEN` 是否正确 |
| 机器人显示离线 | 检查 Bot Token 是否有效；检查网络连接 |
| 命令不工作 | 确保 Message Content Intent 已开启；检查机器人权限 |
| 文件发送失败 | 检查文件大小是否超过 Discord 限制（8MB/50MB） |

## 企业微信相关

| 现象 | 优先检查 |
|---|---|
| 企业微信发送消息后 OpenCode 无反应 | 检查 `WECOM_ENABLED` 是否为 `true`；检查 `WECOM_BOT_ID` 和 `WECOM_SECRET` 是否正确 |
| 消息接收地址配置错误 | 确认 Webhook URL 配置正确 |
| 应用权限不足 | 检查企业微信应用权限设置 |

## OpenCode 相关

| 现象 | 优先检查 |
|---|---|
| `/compact` 失败 | OpenCode 可用模型是否正常；必要时先 `/model <provider:model>` 再重试 |
| `!ls` 等 shell 命令失败 | 当前会话 Agent 是否可用；可先执行 `/agent general` 再重试 |
| OpenCode 连接失败 | 检查 `OPENCODE_HOST` 和 `OPENCODE_PORT` 配置；检查 OpenCode 是否运行 |
| 认证失败（401/403） | 检查 `OPENCODE_SERVER_USERNAME` 和 `OPENCODE_SERVER_PASSWORD` 配置 |
| OpenCode 大于 `v1.2.15` 版本通过飞书发消息无不响应 | 检查 `~/.config/opencode/opencode.json`（linux/mac 为 `config.json`）是否有 `"default_agent": "companion"`，有请删除 |

## 可靠性相关

| 现象 | 优先检查 |
|---|---|
| 心跳似乎没有执行 | 检查 `HEARTBEAT.md` 是否把检查项标记为 `- [ ]`；检查 `memory/heartbeat-state.json` 的 `lastRunAt` 是否更新 |
| 自动救援没有触发 | 检查 `OPENCODE_HOST` 是否为 loopback、`RELIABILITY_LOOPBACK_ONLY` 是否开启、失败次数/窗口是否达到阈值 |
| 自动救援被拒绝（manual） | 检查 `logs/reliability-audit.jsonl` 的 `reason` 字段（常见：`loopback_only_blocked`、`repair_budget_exhausted`） |
| 找不到备份配置 | 检查 `logs/reliability-audit.jsonl` 的 `backupPath`，备份文件命名为 `.bak.<timestamp>.<sha256>` |
| Cron 任务不执行 | 检查 `RELIABILITY_CRON_ENABLED` 是否为 `true`；检查 Cron 任务状态 |

## Web 配置面板相关

| 现象 | 优先检查 |
|---|---|
| Web 配置面板无法访问 | 检查 `ADMIN_PORT` 配置；检查防火墙设置；检查服务是否启动 |
| 配置修改后不生效 | 检查是否为敏感配置（需重启服务）；查看服务日志 |
| 密码错误 | 检查 `.env` 文件中的 `ADMIN_PASSWORD` 配置 |
| 配置丢失 | 检查 `data/config.db` 是否存在；检查是否有备份文件 |

## 会话相关

| 现象 | 优先检查 |
|---|---|
| 私聊首次会推送多条引导消息 | 这是首次流程（建群卡片 + `/help` + `/panel`）；后续会按已绑定会话正常对话 |
| `/send <路径>` 报"文件不存在" | 确认路径正确且为绝对路径；Windows 路径用 `\` 或 `/` 均可 |
| `/send` 报"拒绝发送敏感文件" | 内置安全黑名单拦截了 .env、密钥等敏感文件 |
| 文件发送失败提示大小超限 | 飞书图片上限 10MB、文件上限 30MB；压缩后重试 |
| 会话绑定失败 | 检查 `ENABLE_MANUAL_SESSION_BIND` 配置；检查会话 ID 是否正确 |

## 后台服务相关

| 现象 | 优先检查 |
|---|---|
| 后台模式无法停止 | `logs/bridge.pid` 是否残留；使用 `node scripts/stop.mjs` 清理 |
| 服务启动失败 | 检查端口占用；查看 `logs/service.err` |
| 日志文件过大 | 定期清理 `logs/` 目录；配置日志轮转 |

## 通用排查步骤

1. **查看服务日志**：`logs/service.log` 和 `logs/service.err`
2. **检查配置**：通过 Web 面板或 `data/config.db` 检查配置
3. **重启服务**：通过 Web 面板或 `node scripts/stop.mjs && npm run start`
4. **检查网络**：确保服务器可以访问各平台 API
5. **检查权限**：确保应用/机器人有足够的权限
