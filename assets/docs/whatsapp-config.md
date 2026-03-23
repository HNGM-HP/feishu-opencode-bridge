---
name: whatsapp-config
description: WhatsApp 平台配置指南
type: reference
---

# WhatsApp 平台配置指南

WhatsApp 适配器支持两种模式：
- **Personal 模式**：使用 baileys 库（WhatsApp Web 协议）
- **Business 模式**：使用 WhatsApp Business API

## 环境变量配置

### 通用配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `WHATSAPP_ENABLED` | 是 | `false` | 是否启用 WhatsApp 适配器 |
| `WHATSAPP_MODE` | 否 | `personal` | 运行模式：`personal` 或 `business` |

### Personal 模式配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `WHATSAPP_SESSION_PATH` | 否 | `data/whatsapp-session` | 会话文件存储路径 |

### Business 模式配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `WHATSAPP_BUSINESS_PHONE_ID` | 是 | - | Business Phone ID |
| `WHATSAPP_BUSINESS_ACCESS_TOKEN` | 是 | - | Business Access Token |
| `WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN` | 否 | - | Webhook 验证 Token |

## Personal 模式

### 配置示例

```bash
# .env 文件
WHATSAPP_ENABLED=true
WHATSAPP_MODE=personal
WHATSAPP_SESSION_PATH=/var/lib/whatsapp-session
```

### 扫码登录

Personal 模式启动时会生成二维码，需要使用手机 WhatsApp 扫码登录：

1. 启动服务后，查看日志中的二维码
2. 打开手机 WhatsApp → 设置 → 已关联的设备 → 关联设备
3. 扫描日志中的二维码
4. 登录成功后，会话会自动保存

### 特点

- 使用个人 WhatsApp 账号
- 支持私聊和群聊
- 无需商业账号审核
- 二维码登录，会话持久化

### 限制

- 需要定期扫码维持登录状态
- 官方不推荐使用第三方客户端
- 可能存在账号风险

## Business 模式

### 前置条件

1. 拥有 WhatsApp Business 账号
2. 在 [Meta for Developers](https://developers.facebook.com/) 创建应用
3. 添加 WhatsApp Business API 产品
4. 获取 Phone ID 和 Access Token

### 配置示例

```bash
# .env 文件
WHATSAPP_ENABLED=true
WHATSAPP_MODE=business
WHATSAPP_BUSINESS_PHONE_ID=123456789012345
WHATSAPP_BUSINESS_ACCESS_TOKEN=EAAxxxxxxxxxxxx
WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN=my_verify_token
```

### Webhook 配置

Business 模式需要配置 Webhook 接收消息：

1. 在 Meta 开发者后台设置 Webhook URL
2. 使用 `WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN` 进行验证
3. 订阅 `messages` 事件

### 特点

- 官方 API，稳定可靠
- 支持消息模板
- 支持交互按钮（最多 3 个）
- 需要商业账号

## 消息类型支持

### Personal 模式

| 消息类型 | 发送 | 接收 | 说明 |
|----------|------|------|------|
| 文本 | ✅ | ✅ | 支持，最长 4096 字符 |
| 图片 | ❌ | ✅ | 仅支持接收 |
| 视频 | ❌ | ✅ | 仅支持接收 |
| 音频 | ❌ | ✅ | 仅支持接收 |
| 文档 | ❌ | ✅ | 仅支持接收 |
| 贴纸 | ❌ | ✅ | 仅支持接收 |
| 位置 | ❌ | ✅ | 仅支持接收 |
| 联系人 | ❌ | ✅ | 仅支持接收 |

### Business 模式

| 消息类型 | 发送 | 接收 | 说明 |
|----------|------|------|------|
| 文本 | ✅ | ⚠️ | 需要 Webhook 接收 |
| 交互按钮 | ✅ | ⚠️ | 最多 3 个按钮 |

## ChatId 格式

### Personal 模式

- 私聊：`<phone>@s.whatsapp.net`（如 `8613800138000@s.whatsapp.net`）
- 群聊：`<groupId>@g.us`

### Business 模式

使用纯手机号（不带后缀）

## 故障排查

### Personal 模式

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 无法生成二维码 | 网络问题 | 检查网络连接 |
| 登录后立即断开 | 账号被限制 | 等待一段时间后重试 |
| 会话失效 | 长时间未活动 | 重新扫码登录 |
| 收不到消息 | Socket 断开 | 检查日志，重启服务 |

### Business 模式

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 发送失败 | Token 无效 | 检查 Access Token |
| 收不到消息 | Webhook 未配置 | 配置 Webhook |
| API 错误 | 权限不足 | 检查应用权限 |

### 日志关键词

```
[WhatsApp] Socket 初始化完成    # Personal 模式启动
[WhatsApp] 请扫描二维码登录     # 需要扫码
[WhatsApp] 已连接              # 连接成功
[WhatsApp] 连接已关闭          # 连接断开
[WhatsApp Business] 模式已启用  # Business 模式启动
```

## 安全建议

1. Personal 模式的会话文件包含敏感信息，需妥善保管
2. Business 模式的 Access Token 应定期更换
3. 不要在公网暴露 Personal 模式的服务
4. 监控异常登录活动