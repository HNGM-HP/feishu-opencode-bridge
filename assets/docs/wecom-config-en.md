# WeCom Configuration Guide

This document explains how to configure WeCom bot to connect to OpenCode Bridge.

## Prerequisites

1. OpenCode Bridge service deployed
2. OpenCode installed and running
3. WeCom application or bot created

## Configuration Steps

### 1. Enable WeCom Adapter

In the Web configuration panel (`http://localhost:4098`):

1. Go to "Platform Access" → "WeCom" configuration
2. Set "Enable WeCom Adapter" to `true`
3. Fill in WeCom Bot ID
4. Fill in WeCom Secret
5. Save configuration

### 2. Get WeCom Credentials

#### Get Bot ID

1. Log in to WeCom admin backend
2. Go to "Application Management" → "Applications" → "Self-built"
3. Create or select an existing application
4. Copy "AgentId" as Bot ID from application details page

#### Get Secret

1. In application details page, click "View" button next to "Secret"
2. Copy the Secret value

### 3. Configure Message Receiving

1. In application details page, find "Receive Message" configuration
2. Set API receiving address to:
   ```
   http://your-server-address:your-port/wecom/webhook
   ```
3. Save configuration

### 4. Configure Permissions

In WeCom admin backend, ensure the application has the following permissions:

- Send messages to users/departments/tags
- Read user information
- Manage address book (optional)

## Configuration Parameters

| Parameter | Description | Example |
|---|---|---|
| `WECOM_ENABLED` | Enable WeCom adapter | `true` |
| `WECOM_BOT_ID` | WeCom Bot ID (AgentId) | `1000002` |
| `WECOM_SECRET` | WeCom Secret | `your-secret-here` |
| `WECOM_SHOW_THINKING_CHAIN` | Show AI thinking chain | `true` |
| `WECOM_SHOW_TOOL_CHAIN` | Show tool call chain | `true` |
| `RELIABILITY_CRON_FALLBACK_WECOM_CONVERSATION_ID` | Backup receiver conversationId | `userid or groupid` |

## WeCom Commands

| Command | Description |
|---|---|
| `/help` | View help |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

## Troubleshooting

### WeCom Not Responding

1. Check if `WECOM_ENABLED` is set to `true`
2. Check if `WECOM_BOT_ID` and `WECOM_SECRET` are correct
3. Check if message receiving address is configured correctly
4. Check service logs for error messages

### Message Sending Failed

1. Check if application permissions are sufficient
2. Check if user/group ID is correct
3. Check if network connection is normal

## Notes

1. WeCom adapter currently supports text message interaction
2. Does not support rich text cards (different from Feishu)
3. File sending functionality is limited by WeCom API restrictions
4. Recommend testing configuration in a test group first
