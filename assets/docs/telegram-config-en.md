---
name: telegram-config-en
description: Telegram Platform Configuration Guide
type: reference
---

# Telegram Platform Configuration Guide

The Telegram adapter uses the grammy library and supports Long Polling mode to connect to the Telegram Bot API.

## Features

- Private chat and group chat support
- Text, photo, document, video, audio, and voice message support
- Inline button interactions
- Message editing and deletion
- @mention required in group chats

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_ENABLED` | Yes | `false` | Enable Telegram adapter |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot Token from @BotFather |

## Creating a Telegram Bot

### 1. Get Bot Token

1. Search for **@BotFather** in Telegram
2. Send `/newbot` command
3. Follow prompts to set bot name and username
4. Save the returned Token (format: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`)

### 2. Configure Environment Variables

```bash
# .env file
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
```

## Message Type Support

| Message Type | Send | Receive | Notes |
|--------------|------|---------|-------|
| Text | ✅ | ✅ | Supported, max 4096 characters |
| Photo | ❌ | ✅ | Receive only |
| Document | ❌ | ✅ | Receive only |
| Video | ❌ | ✅ | Receive only |
| Audio | ❌ | ✅ | Receive only |
| Voice | ❌ | ✅ | Receive only |
| Card | ⚠️ | ❌ | Implemented via inline buttons |

## Group Chat Configuration

In group chats, the bot only responds to messages containing @mention:

- ✅ `@mybot hello` - Will respond
- ❌ `hello` - Will not respond

All messages in private chats will be responded to.

## Inline Buttons

Telegram supports inline button interactions:

```typescript
// Send message with buttons
await sender.sendCard(conversationId, {
  text: 'Please select an action',
  buttons: [
    { text: 'Confirm', callback_data: 'confirm' },
    { text: 'Cancel', callback_data: 'cancel' },
  ]
});
```

Button clicks trigger `PlatformActionEvent`.

## File Download

The Telegram adapter supports media file download:

```typescript
const result = await telegramAdapter.downloadFile(fileId);
if (result) {
  const { buffer, fileName, mimeType } = result;
  // Process file
}
```

## Message Management

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

## ChatId Format

Telegram ChatId is a numeric chat ID:

- Private chat: User ID (e.g., `123456789`)
- Group chat: Group ID (e.g., `-1001234567890`)

## Troubleshooting

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

## Permission Settings

Configure in @BotFather:

- `/setprivacy` - Set whether bot can only see @mentioned messages in groups
- `/setcommands` - Set bot command list
- `/setdescription` - Set bot description

## Security Recommendations

1. Don't hardcode tokens in code
2. Use environment variables for sensitive information
3. Regularly check bot usage
4. Monitor abnormal API calls