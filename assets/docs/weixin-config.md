---
name: weixin-config
description: 微信个人号平台配置指南
type: reference
---

# 微信个人号配置指南

微信个人号适配器支持通过 HTTP 长轮询获取消息，实现私人微信与 OpenCode 的对接。

## 功能特性

- 支持多账号管理
- 支持文本、图片、语音、视频、文件等消息类型
- 支持输入状态提示
- 支持会话过期自动暂停
- 支持消息去重

## 前置条件

微信个人号适配器需要配合微信开放平台使用，需要先获取以下信息：

1. **ilinkBotId** - 机器人账号 ID
2. **botToken** - 机器人 Token
3. **baseUrl** - API 基础地址（可选）
4. **cdnBaseUrl** - CDN 基础地址（可选）

## 配置方式

微信个人号通过数据库配置，不使用环境变量。需要在 `config_store` 表中配置账号信息。

### 账号配置表结构

| 字段名 | 类型 | 说明 |
|--------|------|------|
| account_id | TEXT | 账号唯一标识 |
| token | TEXT | 机器人 Token |
| base_url | TEXT | API 基础地址 |
| cdn_base_url | TEXT | CDN 基础地址 |
| enabled | INTEGER | 是否启用（1=启用，0=禁用） |

### 添加账号示例

```sql
INSERT INTO weixin_accounts (account_id, token, base_url, cdn_base_url, enabled)
VALUES (
  'my-weixin-bot',
  'your-bot-token-here',
  'https://ilinkai.weixin.qq.com',
  'https://novac2c.cdn.weixin.qq.com/c2c',
  1
);
```

## ChatId 格式

微信个人号的 ChatId 格式为：

```
weixin::<accountId>::<peerUserId>
```

- `accountId` - 机器人账号 ID
- `peerUserId` - 对方用户 ID

## 消息类型支持

| 消息类型 | 发送 | 接收 | 说明 |
|----------|------|------|------|
| 文本 | ✅ | ✅ | 支持，自动去除 Markdown 格式 |
| 图片 | ❌ | ✅ | 仅支持接收 |
| 语音 | ❌ | ✅ | 仅支持接收 |
| 视频 | ❌ | ✅ | 仅支持接收 |
| 文件 | ❌ | ✅ | 仅支持接收 |
| 卡片 | ⚠️ | ❌ | 降级为纯文本 |

## 限制说明

1. **仅支持私聊** - 不支持群聊消息
2. **不支持消息删除** - 微信协议限制
3. **不支持消息更新** - 微信协议限制
4. **文本格式限制** - 仅支持纯文本，Markdown 会自动转换为纯文本

## 会话管理

### 会话过期处理

当收到 `errcode -14` 时，表示会话已过期，适配器会自动暂停该账号的消息轮询。

### 重启账号

可通过管理接口重启指定账号：

```bash
# 通过 Admin API 重启账号
POST /admin/weixin/restart
Content-Type: application/json

{
  "accountId": "my-weixin-bot"
}
```

### 查看账号状态

```bash
# 通过 Admin API 查看状态
GET /admin/weixin/status?accountId=my-weixin-bot
```

返回示例：

```json
{
  "active": true,
  "paused": false,
  "reason": null
}
```

## 输入状态

微信个人号支持发送输入状态提示：

```typescript
await weixinAdapter.sendTypingIndicator(chatId, TypingStatus.Typing);
```

状态值：
- `0` - 停止输入
- `1` - 正在输入

## 故障排查

### 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 账号自动暂停 | 会话过期（errcode -14） | 检查 Token 是否有效，必要时重新获取 |
| 消息发送失败 | context_token 失效 | 确保接收过对方消息以获取 token |
| 收不到消息 | 账号未启用 | 检查 `enabled` 字段是否为 1 |

### 日志关键词

```
[Weixin] Poll loop started     # 轮询启动
[Weixin] Poll error            # 轮询错误
[Weixin] Session expired       # 会话过期
[Weixin] Send text failed      # 发送失败
```

## 安全建议

1. Token 应存储在加密数据库中
2. 定期更换 Token
3. 限制账号权限，避免过度授权
4. 监控异常消息活动