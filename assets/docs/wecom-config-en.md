# WeCom Configuration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

This document explains how to configure WeCom (WeChat Work) to connect to OpenCode Bridge.

### Features

- Enterprise WeChat integration
- Text message interaction
- Group chat support
- Plain text interaction (no rich cards)

---

## 2. Create WeCom Application

### Step 1: Log in to Admin Backend

1. Visit [WeCom Admin Backend](https://work.weixin.qq.com/)
2. Log in with enterprise admin account
3. Go to **"Application Management"**

### Step 2: Create Application

1. Click **"Applications"** → **"Self-built"**
2. Create new application or select existing one
3. Record the following:
   - **AgentId** (Bot ID)
   - **Secret**

---

## 3. Configure Message Reception

### Set API Receive Address

1. In application details page, find **"Receive Message"** configuration
2. Set API receive address:
   ```
   http://your-server:your-port/wecom/webhook
   ```
3. Configure the following if required:
   - **Token**: Verification token
   - **EncodingAESKey**: Message encryption key
4. Save configuration

---

## 4. Configure Permissions

In WeCom admin backend, ensure application has following permissions:

| Permission | Purpose |
|------------|---------|
| Send messages to users | Send messages to enterprise users |
| Send messages to departments | Send messages to department groups |
| Read user information | Get user details |
| Manage contacts (optional) | Sync organization structure |

---

## 5. Bridge Configuration

### Web Panel Configuration

In the Web configuration panel (`http://localhost:4098`):

1. Go to **"Platform Access"** → **"WeCom"**
2. Set **"Enable WeCom Adapter"** to `true`
3. Fill in **WeCom Bot ID** (AgentId)
4. Fill in **WeCom Secret**
5. Save configuration

### Configuration Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `WECOM_ENABLED` | No | `false` | Enable WeCom adapter |
| `WECOM_BOT_ID` | Yes | - | WeCom Bot ID (AgentId) |
| `WECOM_SECRET` | Yes | - | WeCom Secret |
| `WECOM_SHOW_THINKING_CHAIN` | No | - | Show AI thinking chain |
| `WECOM_SHOW_TOOL_CHAIN` | No | - | Show tool call chain |

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

### Interaction Model

- WeCom uses **plain text** interaction
- No rich text card support (unlike Feishu)
- Commands use `/` prefix

---

## 7. Troubleshooting

### Bot Not Responding

| Check | Action |
|-------|--------|
| `WECOM_ENABLED` | Verify set to `true` |
| `WECOM_BOT_ID` | Verify AgentId is correct |
| `WECOM_SECRET` | Verify Secret is correct |
| Receive URL | Verify API URL is configured in WeCom backend |
| Service logs | View `logs/service.log` for errors |

### Message Send Failed

| Check | Action |
|-------|--------|
| Application permissions | Verify sufficient permissions granted |
| User/Group ID | Verify recipient ID is correct |
| Network | Check network connectivity to WeCom API |

### Cannot Receive Messages

| Check | Action |
|-------|--------|
| Webhook URL | Verify URL is accessible from WeCom |
| Token/AESKey | Verify encryption settings match |
| Event subscription | Verify message events are enabled |

---

## 8. Notes

### Limitations

- **Text only**: WeCom adapter currently supports text message interaction only
- **No rich cards**: Unlike Feishu, WeCom doesn't support rich text cards
- **File sending**: Limited by WeCom API restrictions

### Testing Recommendations

- Test in a test group first
- Verify message encryption settings
- Monitor logs for API rate limits

### Security

- Keep Secret confidential
- Use HTTPS for webhook URL
- Regularly rotate credentials

---

## 9. Related Documentation

- [Commands Reference](commands-en.md) - WeCom command list
- [Troubleshooting Guide](troubleshooting-en.md) - Common issues
- [Deployment Guide](deployment-en.md) - Service operations
