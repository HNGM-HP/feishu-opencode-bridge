# Discord 配置指南

本文档介绍如何配置 Discord 机器人以连接到 OpenCode Bridge。

## 前置条件

1. 已部署 OpenCode Bridge 服务
2. 已安装并运行 OpenCode
3. 已创建 Discord 应用和机器人

## 配置步骤

### 1. 创建 Discord 应用

1. 访问 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击"New Application"创建新应用
3. 填写应用名称，点击"Create"

### 2. 创建机器人

1. 在应用页面，选择"Bot"选项卡
2. 点击"Add Bot"创建机器人
3. 在"Token"部分，点击"Copy"复制 Bot Token
4. 建议开启"Presence Intent"、"Server Members Intent"和"Message Content Intent"

### 3. 启用 Discord 适配器

在 Web 配置面板（`http://localhost:4098`）中：

1. 进入"平台接入" → "Discord"配置
2. 将"是否启用 Discord 适配器"设置为 `true`
3. 填写 Discord Bot Token
4. 填写 Discord Client ID（可选，用于某些高级功能）
5. 保存配置

### 4. 邀请机器人到服务器

1. 在应用页面，选择"OAuth2" → "URL Generator"
2. 在"SCOPES"中选择"bot"
3. 在"BOT PERMISSIONS"中选择所需权限：
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Add Reactions
   - Use Slash Commands（可选）
4. 复制生成的 URL，在浏览器中打开
5. 选择要邀请机器人的服务器，点击"Authorize"

## 配置参数

| 参数 | 说明 | 示例 |
|---|---|---|
| `DISCORD_ENABLED` | 是否启用 Discord 适配器 | `true` |
| `DISCORD_TOKEN` | Discord Bot Token | `your-bot-token-here` |
| `DISCORD_CLIENT_ID` | Discord 应用 Client ID | `123456789012345678` |
| `DISCORD_SHOW_THINKING_CHAIN` | 显示 AI 思维链 | `true` |
| `DISCORD_SHOW_TOOL_CHAIN` | 显示工具调用链 | `true` |
| `RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID` | 备用接收 conversationId | `channel-id-or-dm-id` |

## Discord 命令

| 命令 | 说明 |
|---|---|
| `///session` | 查看绑定的会话 |
| `///new` | 新建并绑定会话 |
| `///bind <sessionId>` | 绑定已有会话 |
| `///undo` | 回撤上一轮 |
| `///compact` | 压缩上下文 |
| `///cron ...` | 管理运行时 Cron 任务 |

## 使用方式

### 私聊

直接向机器人发送消息即可开始对话。

### 群聊

在服务器频道中：
1. @提及机器人，然后发送消息
2. 或者使用 `/` 命令

### 控制面板

使用 `///session` 命令可以查看当前会话状态。

## 故障排查

### Discord 无响应

1. 检查 `DISCORD_ENABLED` 是否设置为 `true`
2. 检查 `DISCORD_TOKEN` 是否正确
3. 检查机器人是否在线（在 Discord 服务器中显示为在线状态）
4. 查看服务日志中的错误信息

### 消息发送失败

1. 检查机器人权限是否足够
2. 检查频道权限是否允许机器人发送消息
3. 检查网络连接是否正常

### 命令不工作

1. 确保消息内容意图（Message Content Intent）已开启
2. 检查机器人是否有读取消息历史的权限
3. 确认命令格式正确

## 注意事项

1. Discord 适配器支持文本消息和组件交互
2. 不支持富文本卡片（与飞书不同，Discord 使用 Embed 和组件）
3. 文件发送功能受限于 Discord API 限制（单个文件最大 8MB，Nitro 服务器 50MB）
4. 建议在测试频道中先验证配置
5. Discord 机器人需要 Message Content Intent 才能读取消息内容
