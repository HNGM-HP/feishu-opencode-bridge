# Configuration Center

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## Architecture Change

Business configuration parameters have been migrated to SQLite database storage (`.env` file now only stores Admin panel startup parameters).

| Storage | Purpose | Content |
|---------|---------|---------|
| **`.env`** | Startup Parameters | `ADMIN_PORT`, `ADMIN_PASSWORD` only |
| **SQLite** (`data/config.db`) | Business Configuration | All platform configs, reliability settings, display controls |

---

## Configuration Management Methods

### Method 1: Web Visual Panel (Recommended)

After service startup, access via browser:

```
http://localhost:4098
```

**Features:**
- Real-time modification of all configuration parameters
- Manage Cron scheduled tasks
- View service running status
- Sensitive fields automatically masked
- Platform connection status viewing
- OpenCode management (install, start, status)

### Method 2: SQLite Database

Configuration stored in `data/config.db` database:

```bash
# View all configuration
sqlite3 data/config.db "SELECT * FROM config_store;"

# Export configuration
sqlite3 data/config.db ".dump" > config-backup.sql
```

### Method 3: .env File (Startup Parameters Only)

The `.env` file now only stores Admin panel startup parameters:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_PORT` | No | `4098` | Web configuration panel listen port |
| `ADMIN_PASSWORD` | No | Auto-generated | Web configuration panel access password |

---

## Business Configuration Parameters

### Basic Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FEISHU_ENABLED` | No | `false` | Enable Feishu adapter |
| `FEISHU_APP_ID` | No | - | Feishu App ID |
| `FEISHU_APP_SECRET` | No | - | Feishu App Secret |
| `FEISHU_ENCRYPT_KEY` | No | - | Feishu Encrypt Key |
| `FEISHU_VERIFICATION_TOKEN` | No | - | Feishu Verification Token |
| `ROUTER_MODE` | No | `legacy` | Router mode: `legacy`/`dual`/`router` |
| `ENABLED_PLATFORMS` | No | - | Platform whitelist, comma-separated |
| `GROUP_REQUIRE_MENTION` | No | `false` | Group chat only responds when explicitly @mentioned |
| `OPENCODE_HOST` | No | `localhost` | OpenCode address |
| `OPENCODE_PORT` | No | `4096` | OpenCode port |
| `OPENCODE_AUTO_START` | No | `false` | Auto-start OpenCode on Bridge startup |
| `OPENCODE_AUTO_START_CMD` | No | `opencode serve` | Custom OpenCode startup command |

---

### Discord Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_ENABLED` | No | `false` | Enable Discord adapter |
| `DISCORD_TOKEN` | No | - | Discord Bot Token (preferred) |
| `DISCORD_BOT_TOKEN` | No | - | Discord Bot Token (alias) |
| `DISCORD_CLIENT_ID` | No | - | Discord Client ID |

---

### WeCom Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WECOM_ENABLED` | No | `false` | Enable WeCom adapter |
| `WECOM_BOT_ID` | No | - | WeCom Bot ID (AgentId) |
| `WECOM_SECRET` | No | - | WeCom Secret |

---

### Telegram Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_ENABLED` | No | `false` | Enable Telegram adapter |
| `TELEGRAM_BOT_TOKEN` | No | - | Telegram Bot Token |

---

### QQ Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QQ_ENABLED` | No | `false` | Enable QQ adapter |
| `QQ_PROTOCOL` | No | `onebot` | Protocol type: `official` or `onebot` |
| `QQ_APP_ID` | Conditional | - | Official protocol: QQ Bot App ID |
| `QQ_SECRET` | Conditional | - | Official protocol: QQ Bot Secret |
| `QQ_CALLBACK_URL` | No | - | Official protocol: Webhook callback URL |
| `QQ_ENCRYPT_KEY` | No | - | Official protocol: Message encryption key |
| `QQ_ONEBOT_WS_URL` | Conditional | - | OneBot protocol: WebSocket URL |
| `QQ_ONEBOT_HTTP_URL` | No | - | OneBot protocol: HTTP API URL |

---

### WhatsApp Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WHATSAPP_ENABLED` | No | `false` | Enable WhatsApp adapter |
| `WHATSAPP_MODE` | No | `personal` | Mode: `personal` or `business` |
| `WHATSAPP_SESSION_PATH` | No | `data/whatsapp-session` | Personal mode: Session file path |
| `WHATSAPP_BUSINESS_PHONE_ID` | Conditional | - | Business mode: Phone ID |
| `WHATSAPP_BUSINESS_ACCESS_TOKEN` | Conditional | - | Business mode: Access Token |
| `WHATSAPP_BUSINESS_WEBHOOK_VERIFY_TOKEN` | No | - | Business mode: Webhook verify token |

---

### WeChat Personal Account Configuration

WeChat personal account is configured via database, not environment variables. See [WeChat Configuration Guide](weixin-config-en.md).

---

### Authentication & Permissions

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENCODE_SERVER_USERNAME` | No | `opencode` | OpenCode Server Basic Auth username |
| `OPENCODE_SERVER_PASSWORD` | No | - | OpenCode Server Basic Auth password |
| `ALLOWED_USERS` | No | - | Feishu open_id whitelist, comma-separated |
| `ENABLE_MANUAL_SESSION_BIND` | No | `true` | Allow binding existing OpenCode sessions |
| `TOOL_WHITELIST` | No | `Read,Glob,Grep,Task` | Auto-allow permission identifiers |

---

### Output & Resources

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PERMISSION_REQUEST_TIMEOUT_MS` | No | `0` | Permission request retention time (ms); `<=0` means no timeout |
| `OUTPUT_UPDATE_INTERVAL` | No | `3000` | Output refresh interval (ms) |
| `ATTACHMENT_MAX_SIZE` | No | `52428800` | Attachment size limit (bytes, default 50MB) |

---

### Work Directory & Projects

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALLOWED_DIRECTORIES` | No | - | Allowed work directory roots, comma-separated |
| `DEFAULT_WORK_DIRECTORY` | No | - | Global default work directory |
| `PROJECT_ALIASES` | No | `{}` | Project alias JSON mapping |
| `GIT_ROOT_NORMALIZATION` | No | `true` | Auto-normalize to Git repository root |

---

### Display Control

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHOW_THINKING_CHAIN` | No | `true` | Global default: show AI thinking chain |
| `SHOW_TOOL_CHAIN` | No | `true` | Global default: show tool call chain |
| `FEISHU_SHOW_THINKING_CHAIN` | No | - | Feishu-specific override |
| `FEISHU_SHOW_TOOL_CHAIN` | No | - | Feishu-specific override |
| `DISCORD_SHOW_THINKING_CHAIN` | No | - | Discord-specific override |
| `DISCORD_SHOW_TOOL_CHAIN` | No | - | Discord-specific override |
| `WECOM_SHOW_THINKING_CHAIN` | No | - | WeCom-specific override |
| `WECOM_SHOW_TOOL_CHAIN` | No | - | WeCom-specific override |

---

### Reliability Cron

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELIABILITY_CRON_ENABLED` | No | `true` | Enable reliability Cron scheduler |
| `RELIABILITY_CRON_API_ENABLED` | No | `false` | Enable runtime Cron HTTP API |
| `RELIABILITY_CRON_API_HOST` | No | `127.0.0.1` | Cron API listen address |
| `RELIABILITY_CRON_API_PORT` | No | `4097` | Cron API listen port |
| `RELIABILITY_CRON_API_TOKEN` | No | - | Cron API Bearer Token |
| `RELIABILITY_CRON_JOBS_FILE` | No | `~/cron/jobs.json` | Runtime Cron jobs persistence file |
| `RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP` | No | `false` | Auto-cleanup orphan Cron jobs |
| `RELIABILITY_CRON_FORWARD_TO_PRIVATE` | No | `false` | Forward to private chat when original window invalid |

---

### Heartbeat Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED` | No | `false` | Enable Bridge proactive heartbeat timer |
| `RELIABILITY_INBOUND_HEARTBEAT_ENABLED` | No | `false` | Enable inbound message triggered heartbeat |
| `RELIABILITY_HEARTBEAT_INTERVAL_MS` | No | `1800000` | Heartbeat polling interval (ms, default 30 min) |
| `RELIABILITY_HEARTBEAT_AGENT` | No | - | Agent used when sending heartbeat to OpenCode |
| `RELIABILITY_HEARTBEAT_PROMPT` | No | Built-in default | Heartbeat prompt |
| `RELIABILITY_HEARTBEAT_ALERT_CHATS` | No | - | Heartbeat alert target Feishu chat_id (comma-separated) |

---

### Rescue Strategy

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELIABILITY_FAILURE_THRESHOLD` | No | `3` | Consecutive failures needed to trigger auto-rescue |
| `RELIABILITY_WINDOW_MS` | No | `90000` | Failure statistics window (ms, default 90 sec) |
| `RELIABILITY_COOLDOWN_MS` | No | `300000` | Cooldown between rescues (ms, default 5 min) |
| `RELIABILITY_REPAIR_BUDGET` | No | `3` | Auto-rescue budget (exhausted → manual intervention) |
| `RELIABILITY_MODE` | No | `observe` | Reliability mode reserved field |
| `RELIABILITY_LOOPBACK_ONLY` | No | `true` | Only allow auto-rescue for localhost |
| `OPENCODE_CONFIG_FILE` | No | `./opencode.json` | OpenCode config file for backup/rollback |

---

## Configuration Migration

### First Startup Migration

On first startup, the system automatically:

1. Detects business configuration in `.env` file
2. Writes configuration to SQLite database (`data/config.db`)
3. Marks migration complete
4. Backs up original `.env` as `.env.backup`

### Configuration Effect Rules

| Configuration Type | Effect After Modification |
|--------------------|---------------------------|
| Display control (`SHOW_*`) | Immediate |
| Whitelist (`ALLOWED_*`) | Immediate |
| Feishu config (`FEISHU_*`) | Requires service restart |
| Discord config (`DISCORD_*`) | Requires service restart |
| WeCom config (`WECOM_*`) | Requires service restart |
| OpenCode connection (`OPENCODE_HOST/PORT`) | Requires service restart |
| Reliability switches (`RELIABILITY_*`) | Requires service restart |

---

## Web Panel API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Get current config (sensitive fields masked) |
| `/api/config` | POST | Save config |
| `/api/cron` | GET | List all Cron tasks |
| `/api/cron/create` | POST | Create Cron task |
| `/api/cron/:id/toggle` | POST | Enable/disable task |
| `/api/cron/:id` | DELETE | Delete task |
| `/api/admin/status` | GET | Get service status |
| `/api/admin/restart` | POST | Restart service |
| `/api/opencode/models` | GET | Get OpenCode available models |
| `/api/opencode/status` | GET | Get OpenCode status |
| `/api/opencode/install` | POST | Install/upgrade OpenCode |
| `/api/opencode/start` | POST | Start OpenCode CLI |

---

## Notes

### TOOL_WHITELIST

String matching is used. Permission events may use `permission` field value (e.g., `external_directory`), configure according to actual identifiers.

### Authentication Configuration

If OpenCode has `OPENCODE_SERVER_PASSWORD` enabled, the bridge must also configure the same `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`, otherwise 401/403 authentication failures will occur.

### ALLOWED_USERS

- **Not configured or empty**: No whitelist; lifecycle cleanup only auto-dissolves groups when member count is `0`
- **Configured**: Whitelist protection enabled; groups auto-dissolve when members insufficient and no member/owner in whitelist

### ALLOWED_DIRECTORIES

- **Not configured or empty**: Users cannot customize paths via `/session new <path>`; only default directory, project aliases, or known project list selection allowed
- **Configured**: User-input paths must fall under allowed root directories (including subdirectories) after normalization and realpath resolution, otherwise rejected
- Multiple root directories separated by comma, e.g., `ALLOWED_DIRECTORIES=/home/user/projects,/opt/repos`

### PROJECT_ALIASES

- JSON format mapping short names to absolute paths, e.g., `{"frontend":"/home/user/frontend"}`
- Users can create sessions via `/session new frontend` without remembering full paths
- Alias paths are also constrained by `ALLOWED_DIRECTORIES`

---

## Related Documentation

- [Deployment Guide](deployment-en.md) - Deployment and operations
- [Reliability Guide](reliability-en.md) - Heartbeat, Cron, rescue configuration
- [Troubleshooting Guide](troubleshooting-en.md) - Common configuration issues
