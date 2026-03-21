# 故障排查指南

| 现象 | 优先检查 |
|---|---|
| 飞书发送消息后 OpenCode 无反应 | 仔细检查飞书权限；确认 [飞书后台配置](feishu-config.md) 正确 |
| 点权限卡片后 OpenCode 无反应 | 日志是否出现权限回传失败；确认回传值是 `once/always/reject` |
| 权限卡或提问卡发不到群 | `.chat-sessions.json` 中 `sessionId -> chatId` 映射是否存在 |
| 卡片更新失败 | 消息类型是否匹配；失败后是否降级为重发卡片 |
| `/compact` 失败 | OpenCode 可用模型是否正常；必要时先 `/model <provider:model>` 再重试 |
| `!ls` 等 shell 命令失败 | 当前会话 Agent 是否可用；可先执行 `/agent general` 再重试 |
| 后台模式无法停止 | `logs/bridge.pid` 是否残留；使用 `node scripts/stop.mjs` 清理 |
| 心跳似乎没有执行 | 检查 `HEARTBEAT.md` 是否把检查项标记为 `- [ ]`；检查 `memory/heartbeat-state.json` 的 `lastRunAt` 是否更新 |
| 自动救援没有触发 | 检查 `OPENCODE_HOST` 是否为 loopback、`RELIABILITY_LOOPBACK_ONLY` 是否开启、失败次数/窗口是否达到阈值 |
| 自动救援被拒绝（manual） | 检查 `logs/reliability-audit.jsonl` 的 `reason` 字段（常见：`loopback_only_blocked`、`repair_budget_exhausted`） |
| 找不到备份配置 | 检查 `logs/reliability-audit.jsonl` 的 `backupPath`，备份文件命名为 `.bak.<timestamp>.<sha256>` |
| 私聊首次会推送多条引导消息 | 这是首次流程（建群卡片 + `/help` + `/panel`）；后续会按已绑定会话正常对话 |
| `/send <路径>` 报"文件不存在" | 确认路径正确且为绝对路径；Windows 路径用 `\` 或 `/` 均可 |
| `/send` 报"拒绝发送敏感文件" | 内置安全黑名单拦截了 .env、密钥等敏感文件 |
| 文件发送失败提示大小超限 | 飞书图片上限 10MB、文件上限 30MB；压缩后重试 |
| OpenCode 大于 `v1.2.15` 版本通过飞书发消息无不响应 | 检查 `~/.config/opencode/opencode.json`（linux/mac 为 `config.json`）是否有 `"default_agent": "companion"`，有请删除 |
