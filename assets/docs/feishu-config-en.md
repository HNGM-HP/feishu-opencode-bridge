# Feishu Configuration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

This document describes how to configure the Feishu application for OpenCode Bridge.

### Connection Mode

**Recommended**: WebSocket Long Connection mode for real-time event delivery.

---

## 2. Event Subscriptions

### Required Events

| Event | Required | Purpose |
|-------|----------|---------|
| `im.message.receive_v1` | Yes | Receive group/private chat messages |
| `im.message.recalled_v1` | Yes | User recall triggers `/undo` rollback |
| `im.chat.member.user.deleted_v1` | Yes | Member leave triggers lifecycle cleanup |
| `im.chat.disbanded_v1` | Yes | Group dismiss triggers session mapping cleanup |
| `card.action.trigger` | Yes | Handle control panel, permission, question callbacks |

### Optional Events

| Event | Required | Purpose |
|-------|----------|---------|
| `im.message.message_read_v1` | No | Read receipt compatibility |

---

## 3. Application Permissions

### Permission Groups

| Capability Group | APIs Called | Purpose |
|------------------|-------------|---------|
| **Message Read/Write** (`im:message`) | `im:message.p2p_msg:readonly`, `im:message.group_at_msg:readonly`, `im:message.group_msg`, `im:message.reactions:read`, `im:message.reactions:write_only` | Send text/cards, streaming updates, recall messages |
| **Group Management** (`im:chat`) | `im:chat.members:read`, `im:chat.members:write_only` | Create groups, invite members, check members, cleanup invalid groups |
| **Resource Download** (`im:resource`) | `im.messageResource.get` | Download image/file attachments and forward to OpenCode |

### Batch Import Permission Configuration

Copy the following JSON to `acc.json`, then import in Feishu Developer Backend → Permission Management → Batch Import/Export:

```json
{
  "scopes": {
    "tenant": [
      "im:message.p2p_msg:readonly",
      "im:chat",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:resource"
    ],
    "user": []
  }
}
```

---

## 4. Configuration Steps

### Step 1: Create Feishu Application

1. Visit [Feishu Open Platform](https://open.feishu.cn/)
2. Create a new application
3. Record the **App ID** and **App Secret**

### Step 2: Configure Event Subscription

1. In application settings, find **"Event Subscription"**
2. Select **"Long Connection"** mode (WebSocket)
3. Add required events from the table above

### Step 3: Configure Permissions

1. Find **"Permission Management"** in application settings
2. Add required permissions individually
3. Or use batch import with the JSON above

### Step 4: Configure Encryption

1. Find **"Encryption"** settings
2. Record the **Encrypt Key** and **Verification Token**
3. Configure in OpenCode Bridge Web panel

---

## 5. Bridge Configuration

Configure the following parameters in Web panel (`http://localhost:4098`):

| Parameter | Required | Description |
|-----------|----------|-------------|
| `FEISHU_ENABLED` | Yes | Set to `true` to enable Feishu |
| `FEISHU_APP_ID` | Yes | Feishu application App ID |
| `FEISHU_APP_SECRET` | Yes | Feishu application App Secret |
| `FEISHU_ENCRYPT_KEY` | No | Feishu Encrypt Key |
| `FEISHU_VERIFICATION_TOKEN` | No | Feishu Verification Token |

---

## 6. Verification

After configuration, verify in Feishu:

1. **Private Chat**: Send a message to the bot in private chat
   - Expected: Bot responds with help message
2. **Group Chat**: @mention the bot and send a message
   - Expected: Bot responds to @mentioned messages

---

## 7. Troubleshooting

### Bot Not Responding

| Check | Action |
|-------|--------|
| `FEISHU_ENABLED` | Verify set to `true` |
| App credentials | Verify App ID and App Secret are correct |
| Event subscription | Verify events are properly configured |
| Permissions | Verify all required permissions are granted |

### Permission Denied

| Check | Action |
|-------|--------|
| Permission status | Verify all required permissions are granted |
| Wait time | Permission changes may take a few minutes to take effect |

### Card Actions Not Working

| Check | Action |
|-------|--------|
| Event subscription | Verify `card.action.trigger` event is subscribed |
| Callback URL | Verify the card callback URL is accessible |
| Network | Check network connectivity to Feishu API |

### Messages Not Received

| Check | Action |
|-------|--------|
| Long connection status | Check WebSocket connection in logs |
| Encrypt Key | Verify encryption key matches Feishu backend |
| Verification Token | Verify token matches Feishu backend |

---

## 8. Related Documentation

- [Commands Reference](commands-en.md) - Feishu command list
- [Troubleshooting Guide](troubleshooting-en.md) - Common issues and solutions
- [Deployment Guide](deployment-en.md) - Service deployment and operations
