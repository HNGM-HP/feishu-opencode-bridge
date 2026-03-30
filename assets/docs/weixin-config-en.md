# WeChat Personal Account Configuration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

The WeChat personal account adapter uses HTTP long polling to receive messages, enabling integration between personal WeChat and OpenCode.

### Features

| Feature | Support |
|---------|---------|
| Multi-account support | ✅ |
| Text messages | ✅ |
| Image messages | ✅ Receive only |
| Voice messages | ✅ Receive only |
| Video messages | ✅ Receive only |
| File messages | ✅ Receive only |
| Typing indicator | ✅ |
| Session expiration handling | ✅ |
| Message deduplication | ✅ |

---

## 2. Prerequisites

The WeChat personal account adapter requires integration with the WeChat Open Platform. You need to obtain:

| Credential | Description |
|------------|-------------|
| **ilinkBotId** | Bot account ID |
| **botToken** | Bot token |
| **baseUrl** | API base URL (optional) |
| **cdnBaseUrl** | CDN base URL (optional) |

---

## 3. Configuration Method

WeChat personal account is configured via **database**, not environment variables.

### Account Configuration Table

Configuration is stored in the `weixin_accounts` table:

| Field | Type | Description |
|-------|------|-------------|
| `account_id` | TEXT | Unique account identifier |
| `token` | TEXT | Bot token |
| `base_url` | TEXT | API base URL |
| `cdn_base_url` | TEXT | CDN base URL |
| `enabled` | INTEGER | Enable status (1=enabled, 0=disabled) |

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

### Enable/Disable Account

```sql
-- Enable account
UPDATE weixin_accounts SET enabled = 1 WHERE account_id = 'my-weixin-bot';

-- Disable account
UPDATE weixin_accounts SET enabled = 0 WHERE account_id = 'my-weixin-bot';
```

---

## 4. ChatId Format

WeChat personal account ChatId format:

```
weixin::<accountId>::<peerUserId>
```

| Component | Description |
|-----------|-------------|
| `accountId` | Bot account ID |
| `peerUserId` | Peer user ID |

---

## 5. Message Type Support

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Markdown auto-converted to plain text |
| Image | ❌ | ✅ | Receive only |
| Voice | ❌ | ✅ | Receive only |
| Video | ❌ | ✅ | Receive only |
| File | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Falls back to plain text |

---

## 6. Limitations

| Limitation | Description |
|------------|-------------|
| **Private chat only** | Group chat messages not supported |
| **No message deletion** | WeChat protocol limitation |
| **No message update** | WeChat protocol limitation |
| **Text format** | Plain text only, Markdown auto-converted |

---

## 7. Session Management

### Session Expiration Handling

When `errcode -14` is received, the session has expired. The adapter automatically:

1. Pauses polling for that account
2. Logs the expiration event
3. Waits for manual restart

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

---

## 8. Typing Indicator

WeChat personal account supports typing indicator:

```typescript
await weixinAdapter.sendTypingIndicator(chatId, TypingStatus.Typing);
```

| Status | Value | Description |
|--------|-------|-------------|
| Stop typing | `0` | Stop typing indicator |
| Typing | `1` | Show typing indicator |

---

## 9. Troubleshooting

### Common Issues

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| Account auto-paused | Session expired (errcode -14) | Check token validity, re-obtain if necessary |
| Message send failed | context_token invalid | Ensure received message from peer to get token |
| Not receiving messages | Account not enabled | Check `enabled` field is 1 |

### Log Keywords

```
[Weixin] Poll loop started     # Polling started
[Weixin] Poll error            # Polling error
[Weixin] Session expired       # Session expired
[Weixin] Send text failed      # Send failed
```

---

## 10. Security Recommendations

| Recommendation | Description |
|----------------|-------------|
| **Encrypted storage** | Store tokens in encrypted database |
| **Regular rotation** | Rotate tokens regularly |
| **Limited permissions** | Avoid over-authorization |
| **Activity monitoring** | Monitor abnormal message activity |

---

## 11. Related Documentation

- [Commands Reference](commands-en.md) - WeChat command list
- [Troubleshooting Guide](troubleshooting-en.md) - Common issues
- [Deployment Guide](deployment-en.md) - Service operations
