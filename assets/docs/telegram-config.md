---
name: telegram-config
description: Telegram 平台配置指南
type: reference
---

# Telegram 平台配置指南

Telegram 适配器使用 grammy 库实现，支持通过 Long Polling 模式连接 Telegram Bot API。

## 功能特性

- 支持私聊和群聊
- 支持文本、图片、文档、视频、音频、语音消息
- 支持内联按钮交互
- 支持消息编辑和删除
- 群聊中 @机器人 才响应

## 环境变量配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `TELEGRAM_ENABLED` | 是 | `false` | 是否启用 Telegram 适配器 |
| `TELEGRAM_BOT_TOKEN` | 是 | - | Bot Token，从 @BotFather 获取 |

## 创建 Telegram Bot

### 1. 获取 Bot Token

1. 在 Telegram 中搜索 **@BotFather**
2. 发送 `/newbot` 命令
3. 按提示设置 Bot 名称和用户名
4. 保存返回的 Token（格式：`123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`）

### 2. 配置环境变量

```bash
# .env 文件
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
```

## 消息类型支持

| 消息类型 | 发送 | 接收 | 说明 |
|----------|------|------|------|
| 文本 | ✅ | ✅ | 支持，最长 4096 字符 |
| 图片 | ❌ | ✅ | 仅支持接收 |
| 文档 | ❌ | ✅ | 仅支持接收 |
| 视频 | ❌ | ✅ | 仅支持接收 |
| 音频 | ❌ | ✅ | 仅支持接收 |
| 语音 | ❌ | ✅ | 仅支持接收 |
| 卡片 | ⚠️ | ❌ | 使用按钮交互实现 |

## 群聊配置

在群聊中，Bot 只会响应包含 @机器人 的消息：

- ✅ `@mybot 你好` - 会响应
- ❌ `你好` - 不会响应

私聊中所有消息都会响应。

## 内联按钮

Telegram 支持内联按钮交互：

```typescript
// 发送带按钮的消息
await sender.sendCard(conversationId, {
  text: '请选择操作',
  buttons: [
    { text: '确认', callback_data: 'confirm' },
    { text: '取消', callback_data: 'cancel' },
  ]
});
```

按钮点击会触发 `PlatformActionEvent`。

## 文件下载

Telegram 适配器支持下载媒体文件：

```typescript
const result = await telegramAdapter.downloadFile(fileId);
if (result) {
  const { buffer, fileName, mimeType } = result;
  // 处理文件
}
```

## 消息管理

### 编辑消息

```typescript
await sender.updateCard(messageId, {
  text: '更新后的内容',
  buttons: [...]
});
```

### 删除消息

```typescript
await sender.deleteMessage(messageId);
```

## ChatId 格式

Telegram 的 ChatId 是数字格式的聊天 ID：

- 私聊：用户 ID（如 `123456789`）
- 群聊：群组 ID（如 `-1001234567890`）

## 故障排查

### 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| Bot 不响应 | Token 无效 | 检查 Token 是否正确 |
| 群聊无响应 | 未 @机器人 | 在消息中 @机器人 |
| Long Polling 错误 | 网络问题 | 检查网络连接 |
| 无法发送消息 | Bot 被封禁 | 检查 Bot 状态 |

### 日志关键词

```
[Telegram] Long Polling 已启动  # 服务启动
[Telegram] 已连接              # 连接成功
[Telegram] 发送文本消息失败     # 发送失败
[Telegram] Long Polling 运行出错 # 运行错误
```

## 权限设置

在 @BotFather 中可配置：

- `/setprivacy` - 设置群聊中 Bot 是否只能看到 @它的消息
- `/setcommands` - 设置 Bot 命令列表
- `/setdescription` - 设置 Bot 描述

## 安全建议

1. 不要在代码中硬编码 Token
2. 使用环境变量存储敏感信息
3. 定期检查 Bot 使用情况
4. 监控异常 API 调用