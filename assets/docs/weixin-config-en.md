---
name: weixin-config-en
description: WeChat Personal Account Platform Configuration Guide
type: reference
---

# WeChat Personal Account Configuration Guide

The WeChat personal account adapter uses HTTP long polling to receive messages, enabling integration between personal WeChat and OpenCode.

## Features

- Multi-account support
- Support for text, image, voice, video, and file messages
- Typing indicator support
- Automatic session expiration handling
- Message deduplication

## Prerequisites

The WeChat personal account adapter requires integration with the WeChat Open Platform. You need to obtain the following:

1. **ilinkBotId** - Bot account ID
2. **botToken** - Bot token
3. **baseUrl** - API base URL (optional)
4. **cdnBaseUrl** - CDN base URL (optional)

## Configuration Method

WeChat personal account is configured via database, not environment variables. Configure account information in the `config_store` table.

### Account Configuration Table Structure

| Field | Type | Description |
|-------|------|-------------|
| account_id | TEXT | Unique account identifier |
| token | TEXT | Bot token |
| base_url | TEXT | API base URL |
| cdn_base_url | TEXT | CDN base URL |
| enabled | INTEGER | Enable status (1=enabled, 0=disabled) |

### Add Account Example

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

## ChatId Format

WeChat personal account ChatId format:

```
weixin::<accountId>::<peerUserId>
```

- `accountId` - Bot account ID
- `peerUserId` - Peer user ID

## Message Type Support

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Supported, Markdown auto-converted to plain text |
| Image | ❌ | ✅ | Receive only |
| Voice | ❌ | ✅ | Receive only |
| Video | ❌ | ✅ | Receive only |
| File | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Falls back to plain text |

## Limitations

1. **Private chat only** - Group chat messages not supported
2. **No message deletion** - WeChat protocol limitation
3. **No message update** - WeChat protocol limitation
4. **Text format restriction** - Plain text only, Markdown auto-converted

## Session Management

### Session Expiration Handling

When `errcode -14` is received, the session has expired. The adapter automatically pauses polling for that account.

### Restart Account

Restart a specific account via admin API:

```bash
POST /admin/weixin/restart
Content-Type: application/json

{
  "accountId": "my-weixin-bot"
}
```

### Check Account Status

```bash
GET /admin/weixin/status?accountId=my-weixin-bot
```

Response example:

```json
{
  "active": true,
  "paused": false,
  "reason": null
}
```

## Typing Indicator

WeChat personal account supports typing indicator:

```typescript
await weixinAdapter.sendTypingIndicator(chatId, TypingStatus.Typing);
```

Status values:
- `0` - Stop typing
- `1` - Typing

## Troubleshooting

### Common Issues

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| Account auto-paused | Session expired (errcode -14) | Check if token is valid, re-obtain if necessary |
| Message send failed | context_token invalid | Ensure you've received a message from the peer to get the token |
| Not receiving messages | Account not enabled | Check if `enabled` field is 1 |

### Log Keywords

```
[Weixin] Poll loop started     # Polling started
[Weixin] Poll error            # Polling error
[Weixin] Session expired       # Session expired
[Weixin] Send text failed      # Send failed
```

## Security Recommendations

1. Store tokens in encrypted database
2. Rotate tokens regularly
3. Limit account permissions to avoid over-authorization
4. Monitor abnormal message activity