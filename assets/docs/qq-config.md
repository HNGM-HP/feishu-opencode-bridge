---
name: qq-config
description: QQ 平台配置指南
type: reference
---

# QQ 平台配置指南

QQ 适配器支持两种协议：
- **official**：QQ 官方频道机器人 API（稳定可靠）
- **onebot**：OneBot 协议（NapCat/go-cqhttp，社区方案）

## 环境变量配置

### 通用配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `QQ_ENABLED` | 是 | `false` | 是否启用 QQ 适配器 |
| `QQ_PROTOCOL` | 否 | `onebot` | 协议类型：`official` 或 `onebot` |

### Official 协议配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `QQ_APP_ID` | 是 | - | QQ 机器人 App ID |
| `QQ_SECRET` | 是 | - | QQ 机器人 Secret |
| `QQ_CALLBACK_URL` | 否 | - | 回调地址（用于 Webhook） |
| `QQ_ENCRYPT_KEY` | 否 | - | 消息加密密钥 |

### OneBot 协议配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `QQ_ONEBOT_WS_URL` | 否 | - | OneBot WebSocket 地址 |
| `QQ_ONEBOT_HTTP_URL` | 否 | - | OneBot HTTP API 地址 |

## Official 协议（QQ 官方频道机器人）

### 创建机器人

1. 访问 [QQ 开放平台](https://bot.q.qq.com/)
2. 创建机器人应用
3. 获取 App ID 和 Secret
4. 配置事件订阅（如需要）

### 配置示例

```bash
# .env 文件
QQ_ENABLED=true
QQ_PROTOCOL=official
QQ_APP_ID=123456789
QQ_SECRET=your-app-secret
QQ_CALLBACK_URL=https://your-domain.com/qq/webhook
QQ_ENCRYPT_KEY=your-encrypt-key
```

### 消息格式

官方 API 消息限制 3000 字符，自动移除 Markdown 格式。

### 特点

- 官方 API，稳定可靠
- 支持私聊和频道消息
- 支持消息加密
- 不支持消息撤回

## OneBot 协议

### 前置条件

需要部署 OneBot 实现：

- **NapCat**：基于 QQ NT 的现代化实现
- **go-cqhttp**：经典实现（已停止维护）
- **LLOneBot**：基于 LiteLoaderQQNT 的实现

### 配置示例

```bash
# .env 文件
QQ_ENABLED=true
QQ_PROTOCOL=onebot
QQ_ONEBOT_WS_URL=ws://127.0.0.1:3001
```

### OneBot 配置

以 NapCat 为例，配置 `napcat.json`：

```json
{
  "http": {
    "enable": false
  },
  "ws": {
    "enable": true,
    "host": "0.0.0.0",
    "port": 3001
  }
}
```

### 特点

- 社区方案，功能丰富
- 支持传统 QQ 群和私聊
- 支持消息撤回
- 需要自行部署 OneBot 实现

## 消息类型支持

### Official 协议

| 消息类型 | 发送 | 接收 | 说明 |
|----------|------|------|------|
| 文本 | ✅ | ✅ | 支持，最长 3000 字符 |
| 图片 | ❌ | ✅ | 仅支持接收 |
| 文件 | ❌ | ✅ | 仅支持接收 |
| 卡片 | ⚠️ | ❌ | 降级为纯文本 |

### OneBot 协议

| 消息类型 | 发送 | 接收 | 说明 |
|----------|------|------|------|
| 文本 | ✅ | ✅ | 支持，最长 3000 字符 |
| 图片 | ❌ | ✅ | 仅支持接收 |
| 文件 | ❌ | ✅ | 仅支持接收 |
| 视频 | ❌ | ✅ | 仅支持接收 |
| 语音 | ❌ | ✅ | 仅支持接收 |
| 卡片 | ⚠️ | ❌ | 降级为纯文本 |

## ChatId 格式

### Official 协议

- 私聊：`c2c_<user_openid>`
- 频道：`group_<group_openid>`

### OneBot 协议

- 私聊：`<user_id>`
- 群聊：`<group_id>_group_`

## 故障排查

### Official 协议

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| Access Token 获取失败 | App ID 或 Secret 错误 | 检查配置 |
| 收不到消息 | 未配置事件订阅 | 在开放平台配置回调 |
| 消息加密失败 | Encrypt Key 错误 | 检查加密密钥 |

### OneBot 协议

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| WebSocket 连接失败 | OneBot 未启动 | 启动 OneBot 服务 |
| 发送消息失败 | 未连接或权限不足 | 检查连接状态和权限 |
| 收不到群消息 | 未加群或被禁言 | 检查机器人群状态 |

### 日志关键词

```
[QQ Official] Access Token 获取成功  # 官方 API 认证成功
[QQ Official] Webhook 服务已启动     # Webhook 启动
[QQ OneBot] WebSocket 已连接         # OneBot 连接成功
[QQ OneBot] WebSocket 断开           # OneBot 断开
```

## 安全建议

1. Secret 和 Encrypt Key 应妥善保管
2. 回调地址应使用 HTTPS
3. 定期检查机器人权限配置
4. 监控异常消息发送行为

## 选择建议

| 场景 | 推荐协议 | 原因 |
|------|----------|------|
| 生产环境 | Official | 官方支持，稳定可靠 |
| 频道机器人 | Official | 原生支持 QQ 频道 |
| 传统 QQ 群 | OneBot | 官方 API 不支持传统群 |
| 快速测试 | OneBot | 部署简单，无需审核 |