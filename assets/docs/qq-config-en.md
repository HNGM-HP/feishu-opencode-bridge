# QQ Configuration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

The QQ adapter supports two protocols:

| Protocol | Description | Use Case |
|----------|-------------|----------|
| **official** | QQ Official Channel Bot API | Production, channel bots |
| **onebot** | OneBot protocol (NapCat/go-cqhttp) | Personal groups, testing |

---

## 2. Environment Variables

### Common Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QQ_ENABLED` | No | `false` | Enable QQ adapter |
| `QQ_PROTOCOL` | No | `onebot` | Protocol type: `official` or `onebot` |

### Official Protocol Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QQ_APP_ID` | Conditional | - | QQ Bot App ID |
| `QQ_SECRET` | Conditional | - | QQ Bot Secret |
| `QQ_CALLBACK_URL` | No | - | Callback URL (for webhook) |
| `QQ_ENCRYPT_KEY` | No | - | Message encryption key |

### OneBot Protocol Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QQ_ONEBOT_WS_URL` | Conditional | - | OneBot WebSocket URL |
| `QQ_ONEBOT_HTTP_URL` | No | - | OneBot HTTP API URL |

---

## 3. Official Protocol (QQ Official Channel Bot)

### Create Bot

1. Visit [QQ Open Platform](https://bot.q.qq.com/)
2. Create a bot application
3. Get **App ID** and **Secret**
4. Configure event subscription (if needed)

### Configuration Example

```bash
# .env file or Web panel
QQ_ENABLED=true
QQ_PROTOCOL=official
QQ_APP_ID=123456789
QQ_SECRET=your-app-secret
QQ_CALLBACK_URL=https://your-domain.com/qq/webhook
QQ_ENCRYPT_KEY=your-encrypt-key
```

### Message Format

- **Character limit**: 3000 characters maximum
- **Markdown**: Automatically removed (plain text only)

### Features

| Feature | Support |
|---------|---------|
| Official API | ✅ Stable and reliable |
| Private chat | ✅ Supported |
| Channel messages | ✅ Supported |
| Message encryption | ✅ Supported |
| Message recall | ❌ Not supported |

---

## 4. OneBot Protocol

### Prerequisites

Deploy an OneBot implementation:

| Implementation | Description |
|----------------|-------------|
| **NapCat** | Modern implementation based on QQ NT |
| **go-cqhttp** | Classic implementation (no longer maintained) |
| **LLOneBot** | Implementation based on LiteLoaderQQNT |

### Configuration Example

```bash
# .env file or Web panel
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

| Feature | Support |
|---------|---------|
| Community solution | ✅ Feature-rich |
| Traditional QQ groups | ✅ Supported |
| Private chats | ✅ Supported |
| Message recall | ✅ Supported |
| Self-hosted | ✅ Required |

---

## 5. Message Type Support

### Official Protocol

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Max 3000 characters |
| Image | ❌ | ✅ | Receive only |
| File | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Falls back to plain text |

### OneBot Protocol

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Max 3000 characters |
| Image | ❌ | ✅ | Receive only |
| File | ❌ | ✅ | Receive only |
| Video | ❌ | ✅ | Receive only |
| Voice | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Falls back to plain text |

---

## 6. ChatId Format

### Official Protocol

| Type | Format | Example |
|------|--------|---------|
| Private chat | `c2c_<user_openid>` | `c2c_abc123` |
| Channel | `group_<group_openid>` | `group_xyz789` |

### OneBot Protocol

| Type | Format | Example |
|------|--------|---------|
| Private chat | `<user_id>` | `123456789` |
| Group chat | `<group_id>_group_` | `987654321_group_` |

---

## 7. Usage

### Available Commands

| Command | Description |
|---------|-------------|
| `/help` | View help information |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

---

## 8. Troubleshooting

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
| Send message failed | Not connected or permissions | Check connection and permissions |
| Not receiving group messages | Not in group or muted | Check bot's group status |

### Log Keywords

```
[QQ Official] Access Token obtained    # Official API auth success
[QQ Official] Webhook service started  # Webhook started
[QQ OneBot] WebSocket connected        # OneBot connected
[QQ OneBot] WebSocket disconnected     # OneBot disconnected
```

---

## 9. Security Recommendations

1. **Keep Secret secure** - Never commit to version control
2. **Use HTTPS** for callback URL
3. **Regularly check** bot permission settings
4. **Monitor** abnormal message sending behavior
5. **Rotate credentials** periodically

---

## 10. Selection Guide

| Use Case | Recommended Protocol | Reason |
|----------|---------------------|--------|
| Production | Official | Official support, stable and reliable |
| Channel bot | Official | Native QQ Channel support |
| Traditional QQ group | OneBot | Official API doesn't support traditional groups |
| Quick testing | OneBot | Simple deployment, no approval needed |

---

## 11. Related Documentation

- [Commands Reference](commands-en.md) - QQ command list
- [Troubleshooting Guide](troubleshooting-en.md) - Common issues
- [Deployment Guide](deployment-en.md) - Service operations
