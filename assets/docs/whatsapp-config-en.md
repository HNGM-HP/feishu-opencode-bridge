---
name: whatsapp-config-en
description: WhatsApp Platform Configuration Guide
type: reference
---

# WhatsApp Platform Configuration Guide

The WhatsApp adapter supports two modes:
- **Personal Mode**: Uses baileys library (WhatsApp Web protocol)
- **Business Mode**: Uses WhatsApp Business API

## Environment Variables

### Common Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WHATSAPP_ENABLED` | Yes | `false` | Enable WhatsApp adapter |
| `WHATSAPP_MODE` | No | `personal` | Running mode: `personal` or `business` |

### Personal Mode Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WHATSAPP_SESSION_PATH` | No | `data/whatsapp-session` | Session file storage path |

### Business Mode Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WHATSAPP_BUSINESS_PHONE_ID` | Yes | - | Business Phone ID |
| `WHATSAPP_BUSINESS_ACCESS_TOKEN` | Yes | - | Business Access Token |
| `WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN` | No | - | Webhook verify token |

## Personal Mode

### Configuration Example

```bash
# .env file
WHATSAPP_ENABLED=true
WHATSAPP_MODE=personal
WHATSAPP_SESSION_PATH=/var/lib/whatsapp-session
```

### QR Code Login

Personal mode generates a QR code on startup. Scan with your phone to log in:

1. After starting the service, check the QR code in logs
2. Open WhatsApp on phone → Settings → Linked devices → Link a device
3. Scan the QR code from logs
4. Session will be saved automatically after successful login

### Features

- Uses personal WhatsApp account
- Supports private and group chats
- No business account approval needed
- QR code login with session persistence

### Limitations

- Periodic re-scanning needed to maintain login
- Third-party clients not officially recommended
- Potential account risk

## Business Mode

### Prerequisites

1. Have a WhatsApp Business account
2. Create an app at [Meta for Developers](https://developers.facebook.com/)
3. Add WhatsApp Business API product
4. Obtain Phone ID and Access Token

### Configuration Example

```bash
# .env file
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

- Official API, stable and reliable
- Message template support
- Interactive button support (max 3)
- Business account required

## Message Type Support

### Personal Mode

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Supported, max 4096 characters |
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
| Text | ✅ | ⚠️ | Requires webhook for receive |
| Interactive Button | ✅ | ⚠️ | Max 3 buttons |

## ChatId Format

### Personal Mode

- Private chat: `<phone>@s.whatsapp.net` (e.g., `8613800138000@s.whatsapp.net`)
- Group chat: `<groupId>@g.us`

### Business Mode

Uses plain phone number (no suffix)

## Troubleshooting

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

## Security Recommendations

1. Personal mode session files contain sensitive information - store securely
2. Business mode Access Tokens should be rotated regularly
3. Don't expose Personal mode service on public networks
4. Monitor abnormal login activity