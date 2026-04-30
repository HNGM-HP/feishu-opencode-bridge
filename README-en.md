# OpenCode Bridge

[![v3.0.0](https://img.shields.io/badge/v3.0.0-3178C6)]()
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[中文](README.md) | [English](README-en.md)**

---

> **OpenCode Bridge** is an enterprise-grade full-featured OpenCode wrapper application that seamlessly integrates OpenCode's AI programming capabilities and intelligent conversation capabilities into mainstream instant messaging platforms, enabling a unified cross-platform, cross-device intelligent collaboration experience.

---

## 🎯 Project Positioning

**OpenCode Bridge** is not just a simple message bridge, but a complete OpenCode wrapper application:

- **🤖 AI Programming Assistant**: Full access to OpenCode's intelligent programming capabilities, supporting code generation, debugging, refactoring, and more
- **💬 Intelligent Conversation System**: Integrated Chat capabilities, providing natural language interaction, knowledge Q&A, task assistance, and other conversational services
- **🔌 Full Platform Adaptation**: One codebase supports 8 major mainstream communication platforms with unified interaction management
- **⚙️ Programmatic Bridge**: Deeply integrated with OpenCode SDK, implementing complete functionality including session management, permission control, and file transfer

Unlike simple message forwarding, OpenCode Bridge provides a complete OpenCode experience wrapper, allowing users to get native OpenCode functionality on any platform.

---

## 📱 Supported Platforms

### Platform Overview

| Platform | Status | Login Method |
|----------|--------|--------------|
| Feishu (Lark) | ✅ Full Support | Bot Application |
| Discord | ✅ Full Support | Bot Token |
| WeCom (Enterprise WeChat) | ✅ Full Support | Bot Application |
| Telegram | ✅ Full Support | Bot Token |
| QQ (OneBot) | ✅ Full Support | OneBot Protocol |
| WhatsApp | ✅ Full Support | Phone Number Pairing |
| WeChat (Personal) | ✅ Full Support | QR Code Login |
| DingTalk | ✅ Full Support | Bot Application |

### Feature Comparison

| Feature | Feishu | Discord | WeCom | Telegram | QQ | WhatsApp | WeChat | DingTalk |
|---------|:------:|:-------:|:-----:|:--------:|:--:|:--------:|:------:|:--------:|
| Text Message | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rich Media/Card | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Streaming Output | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Permission Interaction | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| File Transfer | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Group Chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Private Chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Message Recall | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
|
**> ⚠️ Partial Support**: WeCom and WeChat cannot recall platform messages, but the `/undo` command can revert OpenCode session and send a notification message.

---

## ✨ Key Features

### 🔄 Smart Session Management

- **Independent Session Binding**: Each group/private chat binds to an independent OpenCode session with isolated context
- **Session Migration**: Support session binding, migration, and renaming with context preserved across devices
- **Multi-Project Support**: Multiple project directory switching with alias configuration
- **Auto Cleanup**: Automatic cleanup of invalid sessions to prevent resource leaks

### 🤖 AI Programming Capabilities

- **Intelligent Code Generation**: Support multi-language code generation with real-time syntax highlighting
- **Code Debugging & Analysis**: Automatic error location with fix suggestions
- **Project Context Understanding**: Intelligent analysis based on complete project codebase
- **Shell Command Execution**: Whitelisted commands can be executed directly in chat
- **File Operations**: AI can read/write project files, supporting code refactoring

### 💬 Intelligent Conversation System

- **Natural Language Interaction**: Support multi-turn conversations with complex semantic understanding
- **Knowledge Q&A**: Intelligent Q&A based on OpenCode knowledge base
- **Task Assistance**: Provide task decomposition, step guidance, and other auxiliary functions
- **Context Memory**: Cross-session context preservation and memory management

### 🔌 Deep Integration Capabilities

- **Streaming Output**: Real-time AI response display with thinking chain support
- **Permission Interaction**: AI permission requests confirmed within the chat platform
- **Question Answering**: AI questions answered within the chat platform
- **File Transfer**: AI can send files/screenshots to the chat platform
- **Multimodal Support**: Support images, documents, and other formats

### 🛡️ Reliability Assurance

- **Heartbeat Monitoring**: Periodic OpenCode health probing
- **Auto Rescue**: Automatic restart and recovery when OpenCode crashes
- **Cron Tasks**: Runtime dynamic management of scheduled tasks
- **Log Auditing**: Complete operation logs and error tracking

### 🎛️ Web Management Panel

- **Visual Configuration**: Real-time modification of all configuration parameters in browser
- **Platform Management**: View connection status of each platform
- **Cron Management**: Create, enable/disable, delete scheduled tasks
- **Service Control**: View service status and remote restart

---

## 🏗️ Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   📱 Platform Adapter Layer          │
│  Feishu | Discord | WeCom | Telegram | QQ |         │
│        WhatsApp | WeChat | DingTalk                  │
└──────────────────────┬──────────────────────────────┘
                       │ Unified Message Format
┌──────────────────────▼──────────────────────────────┐
│                   ⚙️ Core Processing Layer           │
│  RootRouter → Session Mgmt / Permission / Q&A        │
│              Programming / Chat / Output Buffer      │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   🔗 Integration Layer                │
│              OpenCode Client SDK                     │
│    (Programming API + Chat API + Session Mgmt)       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   🌐 OpenCode Core                    │
│   AI Programming Service | Chat Service | CLI Tools  │
└─────────────────────────────────────────────────────┘
```

### Architecture Description

| Layer | Responsibility | Key Components |
|-------|----------------|----------------|
| 📱 Platform Adapter Layer | Receive messages from each platform, unified format conversion | 8 Platform Adapters |
| ⚙️ Core Processing Layer | Message routing, session management, business processing | RootRouter, SessionManager, Permission, Question |
| 🔗 Integration Layer | Deep integration with OpenCode, complete functionality calls | OpencodeClient SDK (Programming + Chat) |
| 🌐 OpenCode Core | AI services, conversation services, toolchain | OpenCode Full-Featured Service |

### Comparison with Traditional Bridge

| Feature | Traditional Message Bridge | OpenCode Bridge |
|---------|---------------------------|-----------------|
| Function Scope | Message Forwarding | Complete Feature Wrapper |
| Session Management | Simple Mapping | Deep Integration |
| Capability Support | Single AI | Programming + Chat Dual Capabilities |
| Permission Control | None | Complete Permission Interaction System |
| File Operations | None | Support File Read/Write/Transfer |
| Extensibility | Limited | Support Plugin-based Extensions |

---

## 🚀 Quick Start

### Desktop App (Recommended)

Windows and macOS users can download installers directly from [GitHub Releases](https://github.com/HNGM-HP/opencode-bridge/releases):

| Platform | Download |
|----------|----------|
| Windows | Download `.exe` installer |
| macOS | Download `.dmg` installer |

**Installation Notes:**
- **Windows**: Double-click `.exe` installer and follow the wizard. If you see "unrecognized app" warning, select "Run anyway"
- **macOS**: Double-click `.dmg` to open, drag the app to Applications. First launch requires right-click and select "Open"

After installation, start the app and access `http://localhost:4098` to configure platforms.

---

### NPM Install (Linux / Server)

For Linux servers, NAS, cloud VMs and other headless environments:

```bash
npm install -g opencode-bridge
```

> Or use `npx opencode-bridge` to run directly without installation.

#### Initialize Configuration

```bash
opencode-bridge-manage
```

The deployment wizard will automatically:

- Detect and guide OpenCode installation
- Generate initial `.env` configuration file
- Configure systemd auto-start (Linux)

#### Start Service

```bash
# Start in foreground (for debugging)
opencode-bridge

# Start in background (recommended)
opencode-bridge-start

# Stop service
opencode-bridge-stop

# Management menu (deploy / restart / uninstall, etc.)
opencode-bridge-manage
```

#### Custom Config Directory (Optional)

```bash
opencode-bridge --config-dir /path/to/config
```

---

### Source Deployment (Developers)

```bash
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
```

#### One-Click Deployment

**Linux/macOS:**
```bash
chmod +x ./scripts/deploy.sh
./scripts/deploy.sh
```

**Windows PowerShell:**
```powershell
.\scripts\deploy.ps1
```

This will automatically: detect Node.js / OpenCode → install dependencies and compile → generate config file.

#### Start Service

```bash
# Linux/macOS
./scripts/start.sh

# Windows PowerShell
.\scripts\start.ps1

# Development Mode
npm run dev
```

---

After service starts, access the Web configuration panel:

```
http://localhost:4098
```

> On first access, you will be prompted to set an admin password.

---

## ❓ Common Installation Issues

### macOS: "App is damaged" Error

**Problem**:
```
"OpenCode Bridge" is damaged and can't be opened. You should move it to the Trash.
```

**Reason**:
- macOS security mechanism (Gatekeeper) blocks unsigned apps
- This is a free open-source project without Apple Developer certificate

**Solutions** (choose one):

#### Method 1: Right-click to Open (Recommended)
```
1. Right-click on "OpenCode Bridge.app"
2. Hold the "Option" key on your keyboard
3. Double-click the "Open" button
4. Click "Open" in the confirmation dialog
```

#### Method 2: System Settings Override
```
1. Open "System Settings" → "Privacy & Security"
2. Find the "OpenCode Bridge was blocked" message
3. Click "Open Anyway"
```

#### Method 3: Command Line Remove Quarantine
```bash
# Execute in Terminal (replace with actual path)
xattr -cr /Applications/OpenCode\ Bridge.app
```

**After this one-time operation**, you can launch normally by double-clicking.

---

### Windows: "Unrecognized App" Warning

**Problem**:
```
Windows protected your PC
Microsoft Defender SmartScreen blocked an unrecognized app
```

**Solution**:
1. Click "More info"
2. Click "Run anyway"

**Note**: This is normal Windows Defender protection for unsigned apps. Confirm once and it will run normally.

---

### Can't Access Management Panel After Launch

**Troubleshooting Steps**:

1. **Check if app is running**:
   - **Windows**: Look for OpenCode Bridge icon in system tray (bottom-right)
   - **macOS**: Look for icon in top menu bar

2. **Manually open management panel**:
   ```
   Visit in browser: http://localhost:4098
   ```

3. **Check port usage**:
   ```bash
   # Windows PowerShell
   netstat -ano | findstr :4098

   # macOS/Linux
   lsof -i :4098
   ```

4. **View log files**:
   - **Windows**: `%APPDATA%/opencode-bridge/logs/`
   - **macOS**: `~/Library/Application Support/opencode-bridge/logs/`

---

### Other Issues

If you encounter other issues:
1. Check [Troubleshooting Guide](./assets/docs/troubleshooting.md)
2. Search similar issues in [GitHub Issues](https://github.com/HNGM-HP/opencode-bridge/issues)
3. Submit a new Issue with error logs

---

## 📝 Command Reference

### Common Commands

The following commands are available on all platforms:

| Command | Description |
|---------|-------------|
| `/help` | View help |
| `/status` | View current status |
| `/panel` | Display control panel |
| `/model` | View current model |
| `/model <name>` | Switch model |
| `/models` | List all available models |
| `/agent` | View current agent |
| `/agent <name>` | Switch agent |
| `/agents` | List all available agents |
| `/effort` | View current reasoning effort |
| `/effort <level>` | Set reasoning effort |
| `/session new` | Start new topic |
| `/sessions` | List sessions |
| `/undo` | Undo last interaction |
| `/stop` | Stop current response |
| `/compact` | Compress context |
| `/rename <name>` | Rename session |
| `/project list` | List available projects |
| `/clear` | Reset conversation context |

### Feishu Exclusive Commands

| Command | Description |
|---------|-------------|
| `/send <path>` | Send file to group chat |
| `/cron ...` | Manage Cron tasks |
| `/commands` | Generate command list file |
| `/create_chat` | Show create group card in private chat |
| `!<shell-cmd>` | Passthrough Shell command (whitelist) |
| `//xxx` | Passthrough namespace command |

### Discord Exclusive Commands

| Command | Description |
|---------|-------------|
| `///session` | View bound session |
| `///new` | Create and bind new session |
| `///bind <sessionId>` | Bind existing session |
| `///undo` | Undo last round |
| `///compact` | Compress context |
| `///workdir` | Set working directory |
| `///cron ...` | Manage Cron tasks |

---

## 📚 Documentation

### Core Documentation

| Document | Description |
|----------|-------------|
| [Architecture](assets/docs/architecture-en.md) | Project layered design and core module responsibilities |
| [Configuration](assets/docs/environment-en.md) | Complete configuration parameter reference |
| [Deployment](assets/docs/deployment-en.md) | Deployment, upgrade and systemd configuration |
| [Commands](assets/docs/commands-en.md) | Complete command list and usage |
| [Reliability](assets/docs/reliability-en.md) | Heartbeat, Cron and crash rescue configuration |
| [Troubleshooting](assets/docs/troubleshooting-en.md) | Common issues and solutions |

### Platform Configuration Documentation

| Document | Description |
|----------|-------------|
| [Feishu Config](assets/docs/feishu-config-en.md) | Feishu event subscription and permission configuration |
| [Discord Config](assets/docs/discord-config-en.md) | Discord bot configuration guide |
| [WeCom Config](assets/docs/wecom-config-en.md) | Enterprise WeChat bot configuration guide |
| [Telegram Config](assets/docs/telegram-config-en.md) | Telegram Bot configuration guide |
| [QQ Config](assets/docs/qq-config-en.md) | QQ Official/OneBot protocol configuration guide |
| [WhatsApp Config](assets/docs/whatsapp-config-en.md) | WhatsApp Personal/Business configuration guide |
| [WeChat Personal Config](assets/docs/weixin-config-en.md) | WeChat personal account configuration guide |
| [DingTalk Config](assets/docs/dingtalk-config-en.md) | DingTalk bot Stream mode configuration guide |

### Extended Documentation

| Document | Description |
|----------|-------------|
| [Agent Usage](assets/docs/agent-en.md) | Role configuration and custom Agent |
| [Implementation](assets/docs/implementation-en.md) | Key feature implementation details |
| [SDK API](assets/docs/sdk-api-en.md) | OpenCode SDK integration guide |
| [Workspace Guide](assets/docs/workspace-guide-en.md) | Working directory strategy and project configuration |
| [Rollout](assets/docs/rollout-en.md) | Router mode rollout and rollback |

---

## 📋 Requirements

- **Node.js**: >= 20.0.0
- **Operating System**: Linux / macOS / Windows
- **OpenCode**: Must be installed and running

---

## 🔧 Configuration

### Configuration Methods

| Method | Description |
|--------|-------------|
| Web Panel (Recommended) | Access `http://localhost:4098` for visual configuration |
| SQLite Database | Configuration stored in `data/config.db` |
| .env File | Only stores Admin panel startup parameters |

### Core Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `FEISHU_ENABLED` | `false` | Enable Feishu adapter |
| `DISCORD_ENABLED` | `false` | Enable Discord adapter |
| `OPENCODE_HOST` | `localhost` | OpenCode host address |
| `OPENCODE_PORT` | `4096` | OpenCode port |
| `ADMIN_PORT` | `4098` | Web configuration panel port |

For complete configuration parameters, refer to the [Configuration Center Documentation](assets/docs/environment-en.md).

---

## 🌟 Contributing

If this project helps you, please give it a Star!

[![Star History Chart](https://api.star-history.com/svg?repos=HNGM-HP/opencode-bridge&type=github&theme=hand-drawn)](https://star-history.com/#HNGM-HP/opencode-bridge&Date)

---

## 📄 License

This project is licensed under [GNU General Public License v3.0](LICENSE)

