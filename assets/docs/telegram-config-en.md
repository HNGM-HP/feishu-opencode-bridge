# Telegram Configuration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

The Telegram adapter uses the grammy library and supports Long Polling mode to connect to the Telegram Bot API.

### Features

- Private chat and group chat support
- Text, photo, document, video, audio, and voice message support
- Inline button interactions
- Message editing and deletion
- @mention required in group chats

---

## 2. Create Telegram Bot

### Step 1: Get Bot Token

1. Search for **[@BotFather](https://t.me/BotFather)** in Telegram
2. Send `/newbot` command
3. Follow prompts to set:
   - Bot name (display name)
   - Bot username (must end with `bot`)
4. **Save the returned Token** (format: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`)

### Step 2: Configure Bot Settings

In @BotFather, configure:

| Command | Purpose |
|---------|---------|
| `/setprivacy` | Set whether bot can only see @mentioned messages in groups |
| `/setcommands` | Set bot command list |
| `/setdescription` | Set bot description |
| `/setabouttext` | Set bot about text |

---

## 3. Bridge Configuration

### Web Panel Configuration

In the Web configuration panel (`http://localhost:4098`):

1. Go to **"Platform Access"** → **"Telegram"**
2. Set **"Enable Telegram Adapter"** to `true`
3. Fill in **Telegram Bot Token**
4. Save configuration

### Configuration Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `TELEGRAM_ENABLED` | No | `false` | Enable Telegram adapter |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot Token from @BotFather |
| `TELEGRAM_SHOW_THINKING_CHAIN` | No | - | Show AI thinking chain |
| `TELEGRAM_SHOW_TOOL_CHAIN` | No | - | Show tool call chain |

---

## 4. Message Type Support

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Supported, max 4096 characters |
| Photo | ❌ | ✅ | Receive only |
| Document | ❌ | ✅ | Receive only |
| Video | ❌ | ✅ | Receive only |
| Audio | ❌ | ✅ | Receive only |
| Voice | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Implemented via inline buttons |

---

## 5. Group Chat Configuration

In group chats, the bot **only responds to messages containing @mention**:

| Message | Response |
|---------|----------|
| `@mybot hello` | ✅ Will respond |
| `hello` | ❌ Will not respond |

All messages in **private chats** will be responded to.

---

## 6. Usage

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

### Inline Buttons

Telegram supports inline button interactions:

```
Please select an action:
  [Confirm] [Cancel]
```

Button clicks trigger actions in the bridge.

---

## 7. Troubleshooting

### Common Issues

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| Bot not responding | Invalid token | Check if token is correct |
| No response in group | No @mention | @mention the bot in message |
| Long Polling error | Network issue | Check network connection |
| Cannot send message | Bot blocked | Check bot status |

### Log Keywords

```
[Telegram] Long Polling started   # Service started
[Telegram] Connected              # Connection success
[Telegram] Send text failed       # Send failed
[Telegram] Long Polling error     # Runtime error
```

---

## 8. File Download

The Telegram adapter supports media file download:

```typescript
const result = await telegramAdapter.downloadFile(fileId);
if (result) {
  const { buffer, fileName, mimeType } = result;
  // Process file
}
```

---

## 9. Message Management

### Edit Message

```typescript
await sender.updateCard(messageId, {
  text: 'Updated content',
  buttons: [...]
});
```

### Delete Message

```typescript
await sender.deleteMessage(messageId);
```

---

## 10. ChatId Format

Telegram ChatId format:

| Type | Format | Example |
|------|--------|---------|
| Private chat | User ID | `123456789` |
| Group chat | Group ID (negative) | `-1001234567890` |

---

## 11. Security Recommendations

1. **Don't hardcode tokens** in code
2. **Use environment variables** for sensitive information
3. **Regularly check bot usage** for anomalies
4. **Monitor API calls** for unusual patterns
5. **Regenerate token** if compromised via @BotFather

---

## 12. Related Documentation

- [Commands Reference](commands-en.md) - Telegram command list
- [Troubleshooting Guide](troubleshooting-en.md) - Common issues
- [Deployment Guide](deployment-en.md) - Service operations
