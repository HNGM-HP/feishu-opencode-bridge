# OpenCode Bridge

[![v2.9.5-beta](https://img.shields.io/badge/v2.9.5--beta-3178C6)]()
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[中文](README.md) | [English](README-en.md)**

---

**Feishu / Discord / WeCom / Telegram / QQ / WhatsApp / WeChat × OpenCode Multi-Platform Bridge Service**

Connect the AI coding assistant OpenCode to mainstream instant messaging platforms for cross-platform, cross-device intelligent programming collaboration.

---

## Core Features

### Multi-Platform Unified Access

| Platform | Status | Features |
|----------|--------|----------|
| Feishu (Lark) | Full Support | Card interaction, streaming output, permission confirmation, file transfer |
| Discord | Full Support | Component interaction, Embed messages, Slash commands |
| WeCom (WeChat Work) | Full Support | Text interaction, message sending/receiving |
| Telegram | Full Support | Text interaction, Inline keyboard |
| QQ (OneBot) | Full Support | Text interaction, group chat support |
| WhatsApp | Full Support | Text interaction, media messages |
| WeChat (Personal) | Full Support | QR code login, text interaction |

### Smart Session Management

- **Independent Sessions**: Each group/private chat binds to an independent OpenCode session
- **Session Migration**: Support session binding, migration, renaming; context preserved across devices
- **Project Directory**: Support multi-project directory switching, project alias configuration
- **Session Cleanup**: Automatically clean invalid sessions to prevent resource leaks

### AI Interaction Capabilities

- **Streaming Output**: Real-time AI response display with thinking chain support
- **Permission Interaction**: AI permission requests confirmed within chat platform
- **Question Answering**: AI questions answered within chat platform
- **File Transfer**: AI can send files/screenshots to chat platform
- **Shell Passthrough**: Whitelisted commands can be executed directly in chat

### Reliability Assurance

- **Heartbeat Monitoring**: Periodic OpenCode health probing
- **Auto Rescue**: Automatic restart and recovery when OpenCode crashes
- **Cron Tasks**: Runtime dynamic management of scheduled tasks
- **Log Auditing**: Complete operation logs and error tracking

### Web Management Panel

- **Visual Configuration**: Real-time modification of all configuration parameters in browser
- **Platform Management**: View connection status of each platform
- **Cron Management**: Create, enable/disable, delete scheduled tasks
- **Service Control**: View service status, remote restart

---

## Key Characteristics

### User-Friendly

- Permission confirmation, question answering, and session operations all completed within chat platform
- No dependency on local terminal, use AI coding assistant anytime, anywhere

### Collaboration-Friendly

- Support binding existing sessions and migration binding
- Context preserved when relaying across devices and groups
- Multi-person collaboration sharing the same AI session

### Stability-Friendly

- Session mapping persistent storage
- Dual-end recall consistency assurance
- Same-rule cleanup prevents state misalignment

### Operations-Friendly

- Built-in deployment, upgrade, status check and background management processes
- Support systemd resident running
- Complete logging and monitoring system

### Configuration-Friendly

- Web visual configuration center
- Real-time configuration modification (except for some sensitive configurations)
- Configuration stored in SQLite database, supports backup and recovery

---

## Quick Start

### 1. Clone Project

```bash
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
```

### 2. One-Click Deploy

**Linux/macOS:**
```bash
chmod +x ./scripts/deploy.sh
./scripts/deploy.sh guide
```

**Windows PowerShell:**
```powershell
.\scripts\deploy.ps1 guide
```

This command will automatically:
- Detect and guide Node.js installation
- Detect and guide OpenCode installation
- Install project dependencies and compile
- Generate initial configuration file

### 3. Start Service

**Linux/macOS:**
```bash
./scripts/start.sh
```

**Windows PowerShell:**
```powershell
.\scripts\start.ps1
```

**Development Mode:**
```bash
npm run dev
```

### 4. Configure Platform

After service starts, access Web configuration panel to complete platform configuration:

```
http://localhost:4098
```

On first access, you will be prompted to set an administrator password.

---

## Command Reference

### Feishu Commands

| Command | Description |
|---------|-------------|
| `/help` | View help |
| `/panel` | Open control panel (model, agent, effort) |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/effort <level>` | Set reasoning effort |
| `/session new` | Start new topic |
| `/session <sessionId>` | Bind existing session |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |
| `/project list` | List available projects |
| `/send <path>` | Send file to group |
| `/cron ...` | Manage Cron tasks |
| `!<shell-cmd>` | Passthrough Shell command |

### Discord Commands

| Command | Description |
|---------|-------------|
| `///session` | View bound session |
| `///new` | Create and bind new session |
| `///bind <sessionId>` | Bind existing session |
| `///undo` | Undo last round |
| `///compact` | Compress context |
| `///workdir` | Set working directory |
| `///cron ...` | Manage Cron tasks |

### WeCom Commands

| Command | Description |
|---------|-------------|
| `/help` | View help |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Platform Adapter Layer                    │
│  Feishu │ Discord │ WeCom │ Telegram │ QQ │ WhatsApp │ Weixin │
└────┬────────┬────────┬────────┬────────┬────────┬──────────┘
     │        │        │        │        │        │
     └────────┴────────┴────────┴────────┴────────┘
                        │
              ┌─────────▼─────────┐
              │     Router Layer      │
              │   RootRouter      │
              └─────────┬─────────┘
                        │
     ┌──────────────────┼──────────────────┐
     │                  │                  │
┌────▼────┐      ┌─────▼─────┐      ┌─────▼─────┐
│Permission│     │ Question  │      │ Output    │
│ Handler │      │ Handler   │      │ Buffer    │
└────┬────┘      └─────┬─────┘      └─────┬─────┘
     │                 │                  │
     └─────────────────┼──────────────────┘
                       │
             ┌─────────▼─────────┐
             │   OpenCode Integration   │
             │  OpencodeClient   │
             └─────────┬─────────┘
                       │
             ┌─────────▼─────────┐
             │   OpenCode CLI    │
             └───────────────────┘
```

---

## Detailed Documentation

### Core Documents

| Document | Description |
|----------|-------------|
| [Architecture](assets/docs/architecture-en.md) | Project layered design and core module responsibilities |
| [Configuration](assets/docs/environment-en.md) | Complete configuration parameter reference |
| [Deployment](assets/docs/deployment-en.md) | Deployment, upgrade and systemd configuration |
| [Commands](assets/docs/commands-en.md) | Complete command list and usage |
| [Reliability](assets/docs/reliability-en.md) | Heartbeat, Cron and crash rescue configuration |
| [Troubleshooting](assets/docs/troubleshooting-en.md) | Common issues and solutions |

### Platform Configuration Documents

| Document | Description |
|----------|-------------|
| [Feishu Config](assets/docs/feishu-config-en.md) | Feishu event subscription and permission configuration |
| [Discord Config](assets/docs/discord-config-en.md) | Discord bot configuration guide |
| [WeCom Config](assets/docs/wecom-config-en.md) | WeChat Work bot configuration guide |
| [Telegram Config](assets/docs/telegram-config-en.md) | Telegram Bot configuration guide |
| [QQ Config](assets/docs/qq-config-en.md) | QQ Official/OneBot protocol configuration guide |
| [WhatsApp Config](assets/docs/whatsapp-config-en.md) | WhatsApp Personal/Business configuration guide |
| [WeChat Personal Config](assets/docs/weixin-config-en.md) | WeChat personal account configuration guide |

### Extended Documents

| Document | Description |
|----------|-------------|
| [Agent Usage](assets/docs/agent-en.md) | Role configuration and custom Agent |
| [Implementation](assets/docs/implementation-en.md) | Key feature implementation details |
| [SDK API](assets/docs/sdk-api-en.md) | OpenCode SDK integration guide |
| [Workspace Guide](assets/docs/workspace-guide-en.md) | Working directory strategy and project configuration |
| [Rollout](assets/docs/rollout-en.md) | Router mode rollout and rollback |

---

## License

This project is licensed under [GNU General Public License v3.0](LICENSE)

**GPL v3 means:**
- Free to use, modify and distribute
- Can be used for commercial purposes
- Must open source modified versions
- Must retain original author copyright
- Derivative works must use GPL v3 license

---

If this project helps you, please give it a Star!