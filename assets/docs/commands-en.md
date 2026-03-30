# Command Reference

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## Feishu Commands

### Basic Commands

| Command | Description |
|---------|-------------|
| `/help` | View help information |
| `/panel` | Open control panel (model, role, effort status, stop, undo) |
| `/status` | View current group binding status |

---

### Model & Agent

| Command | Description |
|---------|-------------|
| `/model` | View current model |
| `/model <provider:model>` | Switch model (supports `provider/model` format) |
| `/effort` | View current session reasoning effort and available levels |
| `/effort <level>` | Set session default effort |
| `/effort default` | Clear session effort, return to model default |
| `/fast` | Effort shortcut (maps to `low`) |
| `/balanced` | Effort shortcut (maps to `medium`) |
| `/deep` | Effort shortcut (maps to `high`) |
| `/agent` | View current Agent |
| `/agent <name>` | Switch Agent |
| `/agent off` | Disable Agent, return to default |
| `/role create <spec>` | Create custom role in slash form |
| `创建角色 名称=...; 描述=...; 类型=...; 工具=...` | Create custom role in natural language |

**Effort Levels:** `none`, `minimal`, `low`, `medium`, `high`, `max`, `xhigh`

---

### Session Management

| Command | Description |
|---------|-------------|
| `/stop` | Interrupt current session execution |
| `/undo` | Undo last interaction (OpenCode + Feishu sync) |
| `/compact` | Compress current session context |
| `/sessions` | List current project sessions |
| `/sessions all` | List all sessions from all projects |
| `/session new` | Start new topic (reset context, use default project) |
| `/session new <path or alias>` | Create new session in specified project/directory |
| `/session new --name <name>` | Name session during creation |
| `/session <sessionId>` | Bind existing OpenCode session |
| `/rename <new name>` | Rename current session |
| `/clear` | Equivalent to `/session new` |
| `/clear free session` | Trigger cleanup scan |
| `/clear free session <sessionId>` | Delete specified session |

---

### Project & Directory

| Command | Description |
|---------|-------------|
| `/project list` | List available projects (aliases + history directories) |
| `/project default` | View current group default project |
| `/project default set <path or alias>` | Set default working project for current group |
| `/project default clear` | Clear current group default project |

---

### File & Shell

| Command | Description |
|---------|-------------|
| `/send <absolute path>` | Send specified file to current group |
| `!<shell command>` | Passthrough whitelisted shell command |

**Supported shell commands:** `ls`, `pwd`, `git status`, `git diff`, etc. (non-interactive only)

---

### Group Management

| Command | Description |
|---------|-------------|
| `/create_chat` | Show group creation card in private chat |
| `/建群` | Alias for `/create_chat` |
| `/restart opencode` | Restart local OpenCode process (loopback only) |

---

### Cron Management

| Command | Description |
|---------|-------------|
| `/cron list` | List all runtime Cron tasks |
| `/cron add <spec>` | Add new Cron task |
| `/cron remove <jobId>` | Remove Cron task |
| `/cron pause <jobId>` | Pause Cron task |
| `/cron resume <jobId>` | Resume Cron task |

---

### Namespace Commands

| Command | Description |
|---------|-------------|
| `//<command>` | Passthrough namespace slash command |
| `/commands` | Generate and send latest command list file |

**Example:** `//superpowers:brainstorming`

---

## Discord Commands

Use `///` prefix to avoid conflict with native Slash commands.

---

### Session Management

| Command | Description |
|---------|-------------|
| `///session` | View bound OpenCode session |
| `///new [name] [--dir path/alias]` | Create and bind new session |
| `///new-channel [name] [--dir path/alias]` | Create new channel and bind session |
| `///bind <sessionId>` | Bind existing session |
| `///unbind` | Unbind current channel session |
| `///rename <new name>` | Rename current session |
| `///sessions` | View recent bindable sessions |
| `///undo` | Undo last round |
| `///compact` | Compress context |
| `///compat` | Alias for `///compact` |
| `///clear` | Delete and unbind current channel session |

---

### Model & Effort

| Command | Description |
|---------|-------------|
| `///effort` | View current effort |
| `///effort <level>` | Set session default effort |
| `///effort default` | Clear session effort |

---

### Project & File

| Command | Description |
|---------|-------------|
| `///workdir` | View current working directory |
| `///workdir <path/alias>` | Set working directory |
| `///workdir clear` | Clear working directory |
| `///send <absolute path>` | Send whitelisted file to current channel |
| `发送文件 <absolute path>` | Chinese natural language trigger for file sending |

---

### Control Panel

| Command | Description |
|---------|-------------|
| `///create_chat` | Open dropdown session control panel |
| `///create_chat model <page>` | Open model selection panel |
| `///create_chat session` | Open session panel |
| `///create_chat agent` | Open agent panel |
| `///create_chat effort` | Open effort panel |
| `///restart opencode` | Restart local OpenCode process |

---

### Cron Management

| Command | Description |
|---------|-------------|
| `///cron ...` | Manage runtime Cron tasks (same subcommands as Feishu) |

---

## WeCom Commands

| Command | Description |
|---------|-------------|
| `/help` | View help information |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

**Note:** WeCom uses plain text interaction (no rich text cards).

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/help` | View help information |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

---

## QQ Commands

| Command | Description |
|---------|-------------|
| `/help` | View help information |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

---

## WhatsApp Commands

| Command | Description |
|---------|-------------|
| `/help` | View help information |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

---

## WeChat Personal Commands

| Command | Description |
|---------|-------------|
| `/help` | View help information |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

---

## Notes

### Compatibility Commands

The following compatibility commands are preserved:
- `/session` - Bind existing session
- `/new` - Create new session
- `/new-session` - Create new session
- `/clear` - Clear and create new session

---

### Discord Specifics

- `///create_chat` uses Discord dropdown menus and modals for session control
- `///clear` in session channels (topic contains `oc-session:`) will attempt to delete the channel; if permission denied, only unbind
- `!` passthrough only supports whitelisted commands; interactive editors like `vi`/`vim`/`nano` are not supported

---

### WeCom Specifics

- WeCom doesn't support rich text cards, uses plain text interaction
- File sending is limited by WeCom API restrictions
- Recommend testing in test groups first

---

### Telegram Specifics

- Supports inline keyboard buttons for panels
- Commands work in both private chats and groups

---

### QQ Specifics

- Supports both official protocol and OneBot protocol
- Command prefix is `/` for both protocols

---

### WhatsApp Specifics

- Personal mode: Uses QR code login, session persistence
- Business mode: Uses official WhatsApp Business API

---

### WeChat Personal Specifics

- Uses database configuration (not environment variables)
- Supports QR code login
- Session persistence across restarts

---

### Effort Override

- **Single temporary override**: Use `#low` / `#high` / `#max` / `#xhigh` at message start (only for current message)
- **Effort priority**: `#temp override` > `///effort session default` > `model default`

---

### List Format

**`///sessions` list columns:**
```
Workspace Directory | SessionID | OpenCode Session Name | Binding Details | Current Status
```

**`///create_chat` dropdown labels:**
```
Workspace / Session Short ID / Description
```
Grouped by workspace.

---

### Shell Command Whitelist

The `!<command>` passthrough supports these commands by default:
- `ls`, `pwd`, `cd`, `cat`, `head`, `tail`
- `git status`, `git diff`, `git log`, `git show`
- `find`, `grep`, `ripgrep`
- `npm`, `pnpm`, `yarn` (read-only operations)

Interactive commands (`vi`, `vim`, `nano`, `top`, etc.) are not supported.

---

## Related Documentation

- [Configuration Center](environment-en.md) - Environment variables and settings
- [Deployment Guide](deployment-en.md) - Installation and setup
- [Architecture](architecture-en.md) - System design overview
