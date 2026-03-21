# Command Reference

## Feishu Commands

| Command | Description |
|---|---|
| `/help` | View help |
| `/panel` | Open control panel (model, role, effort status, stop, undo) |
| `/model` | View current model |
| `/model <provider:model>` | Switch model (supports `provider/model`) |
| `/effort` | View current session reasoning effort and available levels for current model |
| `/effort <level>` | Set session default effort (supports `none/minimal/low/medium/high/max/xhigh`) |
| `/effort default` | Clear session effort, return to model default strategy |
| `/fast` `/balanced` `/deep` | Effort shortcut commands (map to `low/high/xhigh` respectively) |
| `/agent` | View current Agent |
| `/agent <name>` | Switch Agent |
| `/agent off` | Disable Agent, return to default |
| `/role create <spec>` | Create custom role in slash form |
| `Create Role name=...; description=...; type=...; tools=...` | Create custom role in natural language and switch |
| `/stop` | Interrupt current session execution |
| `/undo` | Undo last interaction (OpenCode + Feishu sync) |
| `/sessions` | List current project sessions (including unbound and local-only mapping records) |
| `/sessions all` | List all sessions from all projects |
| `/session new` | Start new topic (reset context, use default project) |
| `/session new <project alias or absolute path>` | Create new session in specified project/directory |
| `/session new --name <name>` | Name session during creation (e.g., `/session new --name Technical Architecture Review`) |
| `/rename <new name>` | Rename current session anytime (e.g., `/rename Q3 Backend API Design Discussion`) |
| `/project list` | List available projects (aliases + history directories) |
| `/project default` | View current group default project |
| `/project default set <path or alias>` | Set default working project for current group |
| `/project default clear` | Clear current group default project |
| `/session <sessionId>` | Manually bind existing OpenCode session (supports cross-workspace sessions created via Web; requires `ENABLE_MANUAL_SESSION_BIND` enabled) |
| `New Session Window` | Natural language trigger to create new session (equivalent to `/session new`) |
| `/clear` | Equivalent to `/session new` |
| `/clear free session` / `/clear_free_session` | Manually trigger a fallback scan with same rules as startup cleanup, and clean up zombie Cron |
| `/clear free session <sessionId>` / `/clear_free_session <sessionId>` | Delete specified OpenCode session, remove all local binding mappings and Cron bound to that session |
| `/compact` | Call OpenCode summarize to compress current session context |
| `!<shell command>` | Passthrough whitelisted shell commands (e.g., `!ls`, `!pwd`, `!mkdir`, `!git status`) |
| `/commands` | Generate and send the latest command list file |
| `//<command>` | Pass through a namespaced slash command (for example `//superpowers:brainstorming`) |
| `/create_chat` / `/create-group` | Bring up group creation card in private chat (click "Create Group" after dropdown selection to take effect) |
| `/send <absolute path>` | Send file from specified path to current group chat |
| `/restart opencode` | Restart local OpenCode process (loopback only) |
| `/status` | View current group binding status |

## Discord Commands

Recommended commands (prefer `///` prefix to avoid conflict with native Slash):

| Command | Description |
|---|---|
| `///session` | View OpenCode session bound to current channel |
| `///new [optional name] [--dir path/alias]` | Create new session and bind |
| `///new-channel [optional name] [--dir path/alias]` | Create session channel and bind |
| `///bind <sessionId>` | Bind existing session |
| `///unbind` | Unbind current channel session only |
| `///rename <new name>` | Rename current session |
| `///sessions` | View recent bindable sessions |
| `///effort` | View current effort |
| `///effort <level>` | Set session default effort (validated against current model capabilities) |
| `///effort default` | Clear session effort |
| `///workdir [path/alias/clear]` | Set/view default working directory |
| `///undo` | Undo last turn |
| `///compact` / `///compat` | Compress context |
| `///send <absolute path>` | Send whitelisted file to current channel |
| `Send File <absolute path>` | Chinese natural language trigger to send whitelisted file |
| `///restart opencode` | Restart local OpenCode process (loopback only) |
| `///clear` | Delete and unbind current channel session |
| `///create_chat` | Open dropdown session control panel (view status/new/bind/model/role/undo/compact) |
| `///create_chat model <page>` | Open model pagination panel (max 500 total, 24 per page) |
| `///create_chat session` / `agent` / `effort` | Open category panel |

## Notes

### Compatible Commands
The following compatible commands are retained: `/session`, `/new`, `/new-session`, `/clear`.

### Discord Features
- `///create_chat` uses Discord dropdown menus and modals to complement session control experience.
- `///clear` in session channels (topic with `oc-session:`) will attempt to delete the channel directly; if permissions are insufficient, only unbind.
- `!` passthrough only supports whitelisted commands; interactive editors like `vi`/`vim`/`nano` are not passed through.

### Effort Override
- Single message temporary override can use `#low` / `#high` / `#max` / `#xhigh` at message start (effective for current message only).
- Effort priority: `#temporary override` > `///effort session default` > model default.

### List Format
- `///sessions` list column order is fixed: `Working Directory | SessionID | OpenCode Session Name | Bound Group Details | Current Session Status`.
- `///create_chat` dropdown label order is fixed: `Workspace / Session Short ID / Brief`, displayed aggregated by workspace.
