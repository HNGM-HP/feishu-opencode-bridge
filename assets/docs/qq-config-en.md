---
name: qq-config-en
description: QQ Platform Configuration Guide
type: reference
---

# QQ Platform Configuration Guide

The QQ adapter supports two protocols:
- **official**: QQ Official Channel Bot API (stable and reliable)
- **onebot**: OneBot protocol (NapCat/go-cqhttp, community solution)

## Environment Variables

### Common Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QQ_ENABLED` | Yes | `false` | Enable QQ adapter |
| `QQ_PROTOCOL` | No | `onebot` | Protocol type: `official` or `onebot` |

### Official Protocol Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QQ_APP_ID` | Yes | - | QQ Bot App ID |
| `QQ_SECRET` | Yes | - | QQ Bot Secret |
| `QQ_CALLBACK_URL` | No | - | Callback URL (for webhook) |
| `QQ_ENCRYPT_KEY` | No | - | Message encryption key |

### OneBot Protocol Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QQ_ONEBOT_WS_URL` | No | - | OneBot WebSocket URL |
| `QQ_ONEBOT_HTTP_URL` | No | - | OneBot HTTP API URL |

## Official Protocol (QQ Official Channel Bot)

### Create Bot

1. Visit [QQ Open Platform](https://bot.q.qq.com/)
2. Create a bot application
3. Get App ID and Secret
4. Configure event subscription (if needed)

### Configuration Example

```bash
# .env file
QQ_ENABLED=true
QQ_PROTOCOL=official
QQ_APP_ID=123456789
QQ_SECRET=your-app-secret
QQ_CALLBACK_URL=https://your-domain.com/qq/webhook
QQ_ENCRYPT_KEY=your-encrypt-key
```

### Message Format

Official API has a 3000 character limit. Markdown formatting is automatically removed.

### Features

- Official API, stable and reliable
- Supports private chat and channel messages
- Supports message encryption
- No message recall support

## OneBot Protocol

### Prerequisites

Deploy an OneBot implementation:

- **NapCat**: Modern implementation based on QQ NT
- **go-cqhttp**: Classic implementation (no longer maintained)
- **LLOneBot**: Implementation based on LiteLoaderQQNT

### Configuration Example

```bash
# .env file
QQ_ENABLED=true
QQ_PROTOCOL=onebot
QQ_ONEBOT_WS_URL=ws://127.0.0.1:3001
```

### OneBot Configuration

Example NapCat `napcat.json`:

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

### Features

- Community solution, feature-rich
- Supports traditional QQ groups and private chats
- Supports message recall
- Requires self-hosted OneBot implementation

## Message Type Support

### Official Protocol

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Supported, max 3000 characters |
| Image | ❌ | ✅ | Receive only |
| File | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Falls back to plain text |

### OneBot Protocol

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Supported, max 3000 characters |
| Image | ❌ | ✅ | Receive only |
| File | ❌ | ✅ | Receive only |
| Video | ❌ | ✅ | Receive only |
| Voice | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Falls back to plain text |

## ChatId Format

### Official Protocol

- Private chat: `c2c_<user_openid>`
- Channel: `group_<group_openid>`

### OneBot Protocol

- Private chat: `<user_id>`
- Group chat: `<group_id>_group_`

## Troubleshooting

### Official Protocol

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| Access Token fetch failed | Wrong App ID or Secret | Check configuration |
| Not receiving messages | Event subscription not configured | Configure callback in open platform |
| Message encryption failed | Wrong Encrypt Key | Check encryption key |

### OneBot Protocol

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| WebSocket connection failed | OneBot not started | Start OneBot service |
| Send message failed | Not connected or insufficient permissions | Check connection status and permissions |
| Not receiving group messages | Not in group or muted | Check bot's group status |

### Log Keywords

```
[QQ Official] Access Token obtained    # Official API auth success
[QQ Official] Webhook service started  # Webhook started
[QQ OneBot] WebSocket connected        # OneBot connected
[QQ OneBot] WebSocket disconnected     # OneBot disconnected
```

## Security Recommendations

1. Keep Secret and Encrypt Key secure
2. Use HTTPS for callback URL
3. Regularly check bot permission settings
4. Monitor abnormal message sending behavior

## Selection Guide

| Use Case | Recommended Protocol | Reason |
|----------|---------------------|--------|
| Production | Official | Official support, stable and reliable |
| Channel bot | Official | Native QQ Channel support |
| Traditional QQ group | OneBot | Official API doesn't support traditional groups |
| Quick testing | OneBot | Simple deployment, no approval needed |