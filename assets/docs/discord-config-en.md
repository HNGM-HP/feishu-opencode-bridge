# Discord Configuration Guide

This document explains how to configure Discord bot to connect to OpenCode Bridge.

## Prerequisites

1. OpenCode Bridge service deployed
2. OpenCode installed and running
3. Discord application and bot created

## Configuration Steps

### 1. Create Discord Application

1. Visit [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" to create a new application
3. Fill in application name, click "Create"

### 2. Create Bot

1. In application page, select "Bot" tab
2. Click "Add Bot" to create bot
3. In "Token" section, click "Copy" to copy Bot Token
4. Recommended to enable "Presence Intent", "Server Members Intent", and "Message Content Intent"

### 3. Enable Discord Adapter

In the Web configuration panel (`http://localhost:4098`):

1. Go to "Platform Access" → "Discord" configuration
2. Set "Enable Discord Adapter" to `true`
3. Fill in Discord Bot Token
4. Fill in Discord Client ID (optional, for some advanced features)
5. Save configuration

### 4. Invite Bot to Server

1. In application page, select "OAuth2" → "URL Generator"
2. In "SCOPES", select "bot"
3. In "BOT PERMISSIONS", select required permissions:
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Add Reactions
   - Use Slash Commands (optional)
4. Copy generated URL, open in browser
5. Select server to invite bot to, click "Authorize"

## Configuration Parameters

| Parameter | Description | Example |
|---|---|---|
| `DISCORD_ENABLED` | Enable Discord adapter | `true` |
| `DISCORD_TOKEN` | Discord Bot Token | `your-bot-token-here` |
| `DISCORD_CLIENT_ID` | Discord Application Client ID | `123456789012345678` |
| `DISCORD_SHOW_THINKING_CHAIN` | Show AI thinking chain | `true` |
| `DISCORD_SHOW_TOOL_CHAIN` | Show tool call chain | `true` |
| `RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID` | Backup receiver conversationId | `channel-id-or-dm-id` |

## Discord Commands

| Command | Description |
|---|---|
| `///session` | View bound session |
| `///new` | Create and bind new session |
| `///bind <sessionId>` | Bind existing session |
| `///undo` | Undo last |
| `///compact` | Compress context |
| `///cron ...` | Manage runtime Cron tasks |

## Usage

### Direct Message

Send message directly to bot to start conversation.

### Group Chat

In server channels:
1. @mention bot, then send message
2. Or use `/` commands

### Control Panel

Use `///session` command to view current session status.

## Troubleshooting

### Discord Not Responding

1. Check if `DISCORD_ENABLED` is set to `true`
2. Check if `DISCORD_TOKEN` is correct
3. Check if bot is online (shows online status in Discord server)
4. Check service logs for error messages

### Message Sending Failed

1. Check if bot permissions are sufficient
2. Check if channel permissions allow bot to send messages
3. Check if network connection is normal

### Commands Not Working

1. Ensure Message Content Intent is enabled
2. Check if bot has permission to read message history
3. Confirm command format is correct

## Notes

1. Discord adapter supports text messages and component interactions
2. Does not support rich text cards (different from Feishu, Discord uses Embeds and components)
3. File sending functionality is limited by Discord API restrictions (single file max 8MB, Nitro server 50MB)
4. Recommend testing configuration in a test channel first
5. Discord bot requires Message Content Intent to read message content
