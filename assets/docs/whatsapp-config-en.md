# WhatsApp Configuration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

The WhatsApp adapter supports two modes:

| Mode | Protocol | Description |
|------|----------|-------------|
| **personal** | Baileys (WhatsApp Web) | Personal account integration |
| **business** | WhatsApp Business API | Official business API |

---

## 2. Environment Variables

### Common Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WHATSAPP_ENABLED` | No | `false` | Enable WhatsApp adapter |
| `WHATSAPP_MODE` | No | `personal` | Running mode: `personal` or `business` |

### Personal Mode Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WHATSAPP_SESSION_PATH` | No | `data/whatsapp-session` | Session file storage path |

### Business Mode Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WHATSAPP_BUSINESS_PHONE_ID` | Conditional | - | Business Phone ID |
| `WHATSAPP_BUSINESS_ACCESS_TOKEN` | Conditional | - | Business Access Token |
| `WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN` | No | - | Webhook verify token |

---

## 3. Personal Mode

### Configuration Example

```bash
# .env file or Web panel
WHATSAPP_ENABLED=true
WHATSAPP_MODE=personal
WHATSAPP_SESSION_PATH=/var/lib/whatsapp-session
```

### QR Code Login

Personal mode generates a QR code on startup. Scan with your phone to log in:

1. After starting the service, check the QR code in logs
2. Open WhatsApp on phone → **Settings** → **Linked devices** → **Link a device**
3. Scan the QR code from logs
4. Session will be saved automatically after successful login

### Features

| Feature | Support |
|---------|---------|
| Personal WhatsApp account | ✅ |
| Private chat | ✅ |
| Group chat | ✅ |
| No business approval | ✅ |
| QR code login | ✅ |
| Session persistence | ✅ |

### Limitations

| Limitation | Description |
|------------|-------------|
| Periodic re-scanning | Needed to maintain login |
| Third-party client | Not officially recommended |
| Account risk | Potential account restrictions |

---

## 4. Business Mode

### Prerequisites

1. Have a WhatsApp Business account
2. Create an app at [Meta for Developers](https://developers.facebook.com/)
3. Add WhatsApp Business API product
4. Obtain **Phone ID** and **Access Token**

### Configuration Example

```bash
# .env file or Web panel
WHATSAPP_ENABLED=true
WHATSAPP_MODE=business
WHATSAPP_BUSINESS_PHONE_ID=123456789012345
WHATSAPP_BUSINESS_ACCESS_TOKEN=EAAxxxxxxxxxxxx
WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN=my_verify_token
```

### Webhook Configuration

Business mode requires webhook configuration to receive messages:

1. Set webhook URL in Meta Developer Console
2. Verify using `WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN`
3. Subscribe to `messages` event

### Features

| Feature | Support |
|---------|---------|
| Official API | ✅ Stable and reliable |
| Message templates | ✅ Supported |
| Interactive buttons | ✅ Max 3 buttons |
| Business account | ✅ Required |

---

## 5. Message Type Support

### Personal Mode

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Max 4096 characters |
| Image | ❌ | ✅ | Receive only |
| Video | ❌ | ✅ | Receive only |
| Audio | ❌ | ✅ | Receive only |
| Document | ❌ | ✅ | Receive only |
| Sticker | ❌ | ✅ | Receive only |
| Location | ❌ | ✅ | Receive only |
| Contact | ❌ | ✅ | Receive only |

### Business Mode

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ⚠️ | Requires webhook |
| Interactive Button | ✅ | ⚠️ | Max 3 buttons |

---

## 6. ChatId Format

### Personal Mode

| Type | Format | Example |
|------|--------|---------|
| Private chat | `<phone>@s.whatsapp.net` | `8613800138000@s.whatsapp.net` |
| Group chat | `<groupId>@g.us` | `123456789@g.us` |

### Business Mode

Uses plain phone number (no suffix):

| Type | Format | Example |
|------|--------|---------|
| Private chat | `<phone>` | `8613800138000` |

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

### Personal Mode

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| Cannot generate QR | Network issue | Check network connection |
| Disconnect immediately | Account restricted | Wait and retry |
| Session invalid | Inactive for too long | Re-scan QR code |
| Not receiving messages | Socket disconnected | Check logs, restart service |

### Business Mode

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| Send failed | Invalid token | Check Access Token |
| Not receiving messages | Webhook not configured | Configure webhook |
| API error | Insufficient permissions | Check app permissions |

### Log Keywords

```
[WhatsApp] Socket initialized      # Personal mode started
[WhatsApp] Please scan QR code     # Need to scan QR
[WhatsApp] Connected               # Connection success
[WhatsApp] Connection closed       # Disconnected
[WhatsApp Business] mode enabled   # Business mode started
```

---

## 9. Security Recommendations

1. **Personal mode**: Session files contain sensitive information - store securely
2. **Business mode**: Access Tokens should be rotated regularly
3. **Network**: Don't expose Personal mode service on public networks
4. **Monitoring**: Monitor abnormal login activity
5. **Backup**: Regularly backup session files

---

## 10. Related Documentation

- [Commands Reference](commands-en.md) - WhatsApp command list
- [Troubleshooting Guide](troubleshooting-en.md) - Common issues
- [Deployment Guide](deployment-en.md) - Service operations
