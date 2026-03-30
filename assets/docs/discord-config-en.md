# Discord Configuration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

This document explains how to configure a Discord bot to connect to OpenCode Bridge.

### Features

- Private chat and server channel support
- Text messages and component interactions
- Embeds and button support
- File sending (limited by Discord API)
- Slash command support (`///` prefix)

---

## 2. Create Discord Application

### Step 1: Create Application

1. Visit [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"**
3. Fill in application name, click **"Create"**

### Step 2: Create Bot

1. In application page, select **"Bot"** tab
2. Click **"Add Bot"**
3. In **"Token"** section, click **"Copy"** to copy Bot Token
4. **Save the token securely** (you won't see it again)

### Step 3: Enable Intents

In the Bot tab, enable the following **Privileged Gateway Intents**:

| Intent | Required | Purpose |
|--------|----------|---------|
| **Presence Intent** | No | Presence tracking |
| **Server Members Intent** | No | Member events |
| **Message Content Intent** | **Yes** | **Required for reading message content** |

---

## 3. Invite Bot to Server

### Generate Invite URL

1. In application page, select **"OAuth2"** → **"URL Generator"**
2. In **"SCOPES"** select **"bot"**
3. In **"BOT PERMISSIONS"** select:
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Add Reactions
   - Use Application Commands (optional)

### Invite Bot

1. Copy the generated URL
2. Open in browser
3. Select server to invite bot
4. Click **"Authorize"**

---

## 4. Bridge Configuration

### Web Panel Configuration

In the Web configuration panel (`http://localhost:4098`):

1. Go to **"Platform Access"** → **"Discord"**
2. Set **"Enable Discord Adapter"** to `true`
3. Fill in **Discord Bot Token**
4. Fill in **Discord Client ID** (optional, for advanced features)
5. Save configuration

### Configuration Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `DISCORD_ENABLED` | No | `false` | Enable Discord adapter |
| `DISCORD_TOKEN` | Yes | - | Discord Bot Token |
| `DISCORD_BOT_TOKEN` | No | - | Alias for `DISCORD_TOKEN` |
| `DISCORD_CLIENT_ID` | No | - | Discord application Client ID |
| `DISCORD_SHOW_THINKING_CHAIN` | No | - | Show AI thinking chain |
| `DISCORD_SHOW_TOOL_CHAIN` | No | - | Show tool call chain |

---

## 5. Usage

### Private Chat

Send messages directly to the bot in a direct message (DM).

### Server Channels

- **@mention** the bot, then send message: `@BotName hello`
- Or use **`///` commands**

### Available Commands

| Command | Description |
|---------|-------------|
| `///session` | View bound OpenCode session |
| `///new [name]` | Create and bind new session |
| `///new-channel [name]` | Create new channel and bind session |
| `///bind <sessionId>` | Bind existing session |
| `///unbind` | Unbind current channel session |
| `///rename <new name>` | Rename current session |
| `///sessions` | View recent bindable sessions |
| `///undo` | Undo last round |
| `///compact` | Compress context |
| `///clear` | Delete and unbind current channel session |
| `///workdir` | View/set working directory |
| `///send <path>` | Send file to channel |
| `///create_chat` | Open session control panel |
| `///effort <level>` | Set reasoning effort |
| `///cron ...` | Manage Cron tasks |

---

## 6. Troubleshooting

### Bot Not Responding

| Check | Action |
|-------|--------|
| `DISCORD_ENABLED` | Verify set to `true` |
| `DISCORD_TOKEN` | Verify token is correct |
| Bot status | Check bot shows online in Discord |
| Service logs | View `logs/service.log` for errors |

### Commands Not Working

| Check | Action |
|-------|--------|
| Message Content Intent | Verify enabled in Developer Portal |
| Permissions | Check bot has Read Message History permission |
| Command format | Confirm using `///` prefix |

### Message Send Failed

| Check | Action |
|-------|--------|
| Bot permissions | Verify sufficient permissions in channel |
| Channel permissions | Check channel allows bot to send messages |
| File size | Discord limits: 8MB standard, 50MB Nitro |
| Network | Check network connectivity |

### Bot Shows Offline

| Check | Action |
|-------|--------|
| Token validity | Verify token hasn't been reset |
| Internet connection | Check server network |
| Service status | Verify bridge service is running |

---

## 7. Notes

### Interaction Model

- Discord adapter uses **Embeds** and **Buttons** for rich interactions
- Does not support Feishu-style rich text cards
- File sending limited by Discord API restrictions

### Testing Recommendations

- Test in a private channel first
- Verify bot permissions before production use
- Monitor logs for rate limit warnings

### Security

- Never commit Bot Token to version control
- Regenerate token if compromised
- Use environment variables for sensitive config

---

## 8. Related Documentation

- [Commands Reference](commands-en.md) - Discord command list
- [Troubleshooting Guide](troubleshooting-en.md) - Common issues
- [Deployment Guide](deployment-en.md) - Service operations
