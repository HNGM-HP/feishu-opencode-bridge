# Environment Variables Configuration

Based on actual reading from `src/config.ts` and `src/index.ts`:

## Basic Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `FEISHU_APP_ID` | Yes | - | Feishu App ID |
| `FEISHU_APP_SECRET` | Yes | - | Feishu App Secret |
| `ROUTER_MODE` | No | `legacy` | Router mode: `legacy`/`dual`/`router` |
| `ENABLED_PLATFORMS` | No | - | Platform whitelist, comma-separated (e.g., `feishu,discord`) |
| `GROUP_REQUIRE_MENTION` | No | `false` | When `true`, group chats only respond when explicitly @mentioning the bot |
| `OPENCODE_HOST` | No | `localhost` | OpenCode host address |
| `OPENCODE_PORT` | No | `4096` | OpenCode port |
| `OPENCODE_AUTO_START` | No | `false` | When `true`, Bridge automatically starts OpenCode background process on startup |
| `OPENCODE_AUTO_START_CMD` | No | `opencode serve` | Custom OpenCode startup command (default is headless background mode) |

## Discord Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_ENABLED` | No | `false` | Enable Discord adapter |
| `DISCORD_TOKEN` | No | - | Discord Bot Token (preferred) |
| `DISCORD_BOT_TOKEN` | No | - | Discord Bot Token (compatible alias) |
| `DISCORD_CLIENT_ID` | No | - | Discord Application Client ID |

## Authentication & Permissions

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_SERVER_USERNAME` | No | `opencode` | OpenCode Server Basic Auth username |
| `OPENCODE_SERVER_PASSWORD` | No | - | OpenCode Server Basic Auth password |
| `ALLOWED_USERS` | No | - | Feishu open_id whitelist, comma-separated; empty means no whitelist |
| `ENABLE_MANUAL_SESSION_BIND` | No | `true` | Allow binding existing OpenCode sessions; when disabled, only new sessions allowed |
| `TOOL_WHITELIST` | No | `Read,Glob,Grep,Task` | Auto-allow permission identifier list |

## Output & Resources

| Variable | Required | Default | Description |
|---|---|---|---|
| `PERMISSION_REQUEST_TIMEOUT_MS` | No | `0` | Permission request retention time on bridge (ms); `<=0` means no timeout, wait indefinitely |
| `OUTPUT_UPDATE_INTERVAL` | No | `3000` | Output refresh interval (ms) |
| `ATTACHMENT_MAX_SIZE` | No | `52428800` | Attachment size limit (bytes) |

## Working Directory & Projects

| Variable | Required | Default | Description |
|---|---|---|---|
| `ALLOWED_DIRECTORIES` | No | - | Allowed working directory root list, comma-separated absolute paths; unconfigured means user cannot customize paths, and `/send` file sending is rejected |
| `DEFAULT_WORK_DIRECTORY` | No | - | Global default working directory (lowest priority fallback); unconfigured follows OpenCode server default |
| `PROJECT_ALIASES` | No | `{}` | Project alias JSON mapping (e.g., `{"fe":"/home/user/fe"}`), supports short name session creation |
| `GIT_ROOT_NORMALIZATION` | No | `true` | Automatically normalize directory to Git repository root |

## Display Control

| Variable | Required | Default | Description |
|---|---|---|---|
| `SHOW_THINKING_CHAIN` | No | `true` | Global default: show AI thinking chain (thinking content) |
| `SHOW_TOOL_CHAIN` | No | `true` | Global default: show tool call chain |
| `FEISHU_SHOW_THINKING_CHAIN` | No | - | Feishu specific: override global `SHOW_THINKING_CHAIN`, inherits global if unset |
| `FEISHU_SHOW_TOOL_CHAIN` | No | - | Feishu specific: override global `SHOW_TOOL_CHAIN`, inherits global if unset |
| `DISCORD_SHOW_THINKING_CHAIN` | No | - | Discord specific: override global `SHOW_THINKING_CHAIN`, inherits global if unset |
| `DISCORD_SHOW_TOOL_CHAIN` | No | - | Discord specific: override global `SHOW_TOOL_CHAIN`, inherits global if unset |

## Reliability Cron

| Variable | Required | Default | Description |
|---|---|---|---|
| `RELIABILITY_CRON_ENABLED` | No | `true` | Enable reliability Cron scheduler |
| `RELIABILITY_CRON_API_ENABLED` | No | `false` | Enable runtime Cron HTTP API |
| `RELIABILITY_CRON_API_HOST` | No | `127.0.0.1` | Cron API listen address |
| `RELIABILITY_CRON_API_PORT` | No | `4097` | Cron API listen port |
| `RELIABILITY_CRON_API_TOKEN` | No | - | Cron API Bearer Token (Authorization header required when enabled) |
| `RELIABILITY_CRON_JOBS_FILE` | No | `~/cron/jobs.json` | Runtime Cron task persistence file |
| `RELIABILITY_CRON_ORPHAN_AUTO_CLEANUP` | No | `false` | Auto cleanup orphan Cron (startup scan / group dismiss or channel delete linkage / stale cleanup) |
| `RELIABILITY_CRON_FORWARD_TO_PRIVATE` | No | `false` | Allow forward to private/backup window when original chat window is invalid |
| `RELIABILITY_CRON_FALLBACK_FEISHU_CHAT_ID` | No | - | Feishu backup receiver chat_id |
| `RELIABILITY_CRON_FALLBACK_DISCORD_CONVERSATION_ID` | No | - | Discord backup receiver conversationId |

## Heartbeat Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED` | No | `false` | Enable Bridge proactive heartbeat timer |
| `RELIABILITY_INBOUND_HEARTBEAT_ENABLED` | No | `false` | Enable "inbound message triggers heartbeat" (compatibility mode) |
| `RELIABILITY_HEARTBEAT_INTERVAL_MS` | No | `1800000` | Bridge proactive heartbeat polling interval (ms) |
| `RELIABILITY_HEARTBEAT_AGENT` | No | - | Agent used for proactive heartbeat to OpenCode |
| `RELIABILITY_HEARTBEAT_PROMPT` | No | Built-in default | Proactive heartbeat prompt (recommended to include HEARTBEAT_OK convention) |
| `RELIABILITY_HEARTBEAT_ALERT_CHATS` | No | - | Heartbeat alert push target Feishu chat_id (comma-separated) |

## Rescue Strategy

| Variable | Required | Default | Description |
|---|---|---|---|
| `RELIABILITY_FAILURE_THRESHOLD` | No | `3` | Consecutive failures needed to trigger auto-rescue in infinite reconnection scenario |
| `RELIABILITY_WINDOW_MS` | No | `90000` | Failure statistics window (ms) in infinite reconnection scenario |
| `RELIABILITY_COOLDOWN_MS` | No | `300000` | Cooldown time (ms) between two auto-rescues |
| `RELIABILITY_REPAIR_BUDGET` | No | `3` | Auto-rescue budget (manual intervention after exhausted) |
| `RELIABILITY_MODE` | No | `observe` | Reliability mode reserved field (current version uses threshold/budget strategy) |
| `RELIABILITY_LOOPBACK_ONLY` | No | `true` | Only allow auto-rescue on `localhost/127.0.0.1/::1` |
| `OPENCODE_CONFIG_FILE` | No | `./opencode.json` | OpenCode config file path for backup and fallback during crash rescue |

## Notes

**`TOOL_WHITELIST`**: Does string matching; permission events may use `permission` field value (e.g., `external_directory`), configure according to actual identifiers.

**Authentication Configuration**: If OpenCode has `OPENCODE_SERVER_PASSWORD` enabled, the bridge must also configure the same `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`, otherwise 401/403 authentication failures will occur.

**Model Strategy**: Only when both `DEFAULT_PROVIDER` and `DEFAULT_MODEL` are configured, the bridge will explicitly specify the model; otherwise determined by OpenCode's own default model.

**`ALLOWED_USERS`**:
- Unconfigured or empty: No whitelist enabled; lifecycle cleanup only dismisses groups when member count is `0`.
- Configured: Whitelist protection enabled; auto-dismiss when group members are insufficient and neither group members nor owner are in whitelist.

**`ENABLE_MANUAL_SESSION_BIND` Semantics**:
- `true`: Allow `/session <sessionId>`, and group creation card can select "Bind existing session".
- `false`: Disable manual binding capability; group creation card only retains "New session".

**`ALLOWED_DIRECTORIES`**:
- Unconfigured or empty: Users cannot customize paths via `/session new <path>`; only allow using default directory, project aliases, or selecting from known project list.
- Configured: User input paths must fall under allowed root directories (including subdirectories) after normalization and realpath resolution, otherwise rejected.
- Multiple roots comma-separated, e.g., `ALLOWED_DIRECTORIES=/home/user/projects,/opt/repos`.
- Windows supports Windows format paths, using forward `/` or backslash `\` as path separators.

**`PROJECT_ALIASES`**:
- JSON format mapping short names to absolute paths, e.g., `{"frontend":"/home/user/frontend"}`.
- Users can create sessions using aliases via `/session new frontend`, no need to memorize full paths.
- Alias paths are also constrained by `ALLOWED_DIRECTORIES`.
