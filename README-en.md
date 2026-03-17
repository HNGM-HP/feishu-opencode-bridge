# Feishu / Discord × OpenCode Bridge Service v2.9.1-beta

[![v2.9.1-beta](https://img.shields.io/badge/v2.9.1--beta-3178C6)]()
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[中文](README.md)** | **[English](README-en.md)**

---

A cross-platform bridge layer that serves both Feishu and Discord. `v2.9.1-beta` refactors the core from "single-file logic stack" to "platform adapter layer + root router + OpenCode event hub + domain processors", focusing on cross-platform scalability, permission loop stability, directory instance consistency, and production maintainability.

With runtime Cron (API + `/cron` + `///cron` + natural language parsing) and local reliability governance, this project further closes the capability gap with OpenClaw in "automated scheduling + ops availability", while maintaining advantages in multi-platform routing and permission loop engineering.

## 📋 Table of Contents

- [Pain Points](#pain-points)
- [Why Use This](#why-use-this)
- [Capabilities Overview](#capabilities-overview)
- [Demo](#demo)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Deployment & Ops](#deployment--ops)
- [Environment Variables](#environment-variables)
- [Reliability Features](#reliability-features)
- [Feishu Configuration](#feishu-configuration)
- [Commands](#commands)
- [Agent Usage](#agent-usage)
- [Detailed Documentation](#detailed-documentation)

<a id="pain-points"></a>
## 🎯 Pain Points

- Permission and question links must form a strict loop: `permission.asked` / `question.asked` must close properly, or tasks will stall.
- Cross-platform parallelism risks cross-wiring: session binding, permission queues, and output buffers must be isolated by platform.
- Directory instance consistency is a common pitfall: logs may show "allowed" but the OpenCode directory instance wasn't hit, causing tasks to hang.
- Cards and text have different interaction models: Feishu and Discord cannot share the same interaction paradigm; each must use native platform capabilities.
- Ops closure requirements are increasing: "running" is not enough; it must be verifiable, rollbackable, and support gray deployment.

This project solves not "can it reply to messages" but "can cross-platform AI tasks achieve long-term stable closure".

<a id="why-use-this"></a>
## 💡 Why Use This

- User-friendly: permission confirmation, question answering, and session operations all happen within Feishu, without relying on local terminals.
- Collaboration-friendly: supports binding existing sessions and migration binding, maintaining context across devices and groups.
- Stability-friendly: session mapping persistence + dual-end undo + consistent cleanup rules avoid "surface normal, state错位".
- Ops-friendly: built-in deployment, upgrade, status checks, and background management workflows suitable for continuous托管运行.
- Future-version friendly: compatible with OpenCode Server Basic Auth, ready for mandatory password enforcement.

<a id="capabilities-overview"></a>
## 📸 Capabilities Overview

| Capability | What You Get | Related Commands/Config |
|---|---|---|
| Unified group/private routing | Single entry point for private and group chat, routed to correct session | Group @bot; private direct message |
| Private chat session selection | Choose "new session / bind existing" when creating chat | `/create_chat`, `/建群` |
| Manual session binding | Directly connect specified session to current group without interrupting context | `/session <sessionId>`, `ENABLE_MANUAL_SESSION_BIND` |
| Migration binding & delete protection | Auto-migrate old group mappings and protect sessions from accidental deletion | Auto-enabled (manual binding scenarios) |
| Lifecycle cleanup fallback | Startup cleanup and manual cleanup share same rules, reducing accidental cleanup | `/clear free session` |
| Permission card loop | OpenCode permission requests confirmed within Feishu with result callback | `permission.asked` |
| Question card loop | OpenCode questions answered/skipped within Feishu to continue tasks | `question.asked` |
| Stream multi-card overflow protection | Auto-paginate when exceeding component budget, continuous old page updates | Stream card pagination (budget 180) |
| Dual-end undo consistency | Undo rolls back both Feishu messages and OpenCode session state | `/undo` |
| Model/role/intensity visual control | Switch model, role, reasoning intensity per session with panel view and commands | `/panel`, `/model`, `/agent`, `/effort` |
| Context compression | Trigger session summarize within Feishu to free context window | `/compact` |
| Shell command passthrough | Whitelisted `!` commands execute via OpenCode shell with echoed output | `!ls`, `!pwd`, `!git status` |
| Server auth compatible | Supports OpenCode Server Basic Auth, ready for mandatory password default | `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD` |
| File send to Feishu | AI can send files/screenshots from computer directly to current Feishu group | `/send`, `发送文件` |
| Working directory/project management | Specify working directory when creating session, with project aliases, group defaults, 9-stage security validation | `/project list`, `/session new <alias>`, `ALLOWED_DIRECTORIES` |
| OpenCode local reliability governance | Runtime Cron (API/command/natural language) + local crash auto-rescue (with config backup/2-level fallback) + optional proactive heartbeat | `HEARTBEAT.md`, `RELIABILITY_*`, `logs/reliability-audit.jsonl` |
| Deployment/ops closure | Integrated entry point for deploy/upgrade/check/background/systemd | `scripts/deploy.*`, `scripts/start.*` |

<a id="demo"></a>
## 🖼️ Demo

<details>
<summary>Step 1: Private Chat Independent Session (Click to expand)</summary>

<p>
  <img src="assets/demo/1-1 私聊独立会话.png" width="720" />
  <img src="assets/demo/1-2 私聊独立会话.png" width="720" />
  <img src="assets/demo/1-3 私聊独立会话.png" width="720" />
  <img src="assets/demo/1-4 私聊独立会话.png" width="720" />
</p>

</details>

<details>
<summary>Step 2: Multi-Group Independent Sessions (Click to expand)</summary>

<p>
  <img src="assets/demo/2-1 多群聊独立会话.png" width="720" />
  <img src="assets/demo/2-2 多群聊独立会话.png.png" width="720" />
  <img src="assets/demo/2-3 多群聊独立会话.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 3: Image Attachment Parsing (Click to expand)</summary>

<p>
  <img src="assets/demo/3-1 图片附件解析.png" width="720" />
  <img src="assets/demo/3-2 图片附件解析.png.png" width="720" />
  <img src="assets/demo/3-3 图片附件解析.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 4: Interactive Tools Test (Click to expand)</summary>

<p>
  <img src="assets/demo/4-1 交互工具测试.png" width="720" />
  <img src="assets/demo/4-2 交互工具测试.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 5: Low-level Permission Test (Click to expand)</summary>

<p>
  <img src="assets/demo/5-1 底层权限测试.png" width="720" />
  <img src="assets/demo/5-2 底层权限测试.png.png" width="720" />
  <img src="assets/demo/5-3 底层权限测试.png.png" width="720" />
  <img src="assets/demo/5-4 底层权限测试.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 6: Session Cleanup (Click to expand)</summary>

<p>
  <img src="assets/demo/6-1 会话清理.png" width="720" />
  <img src="assets/demo/6-2 会话清理.png.png" width="720" />
  <img src="assets/demo/6-3 会话清理.png.png" width="720" />
</p>

</details>

<a id="architecture"></a>
## 📌 Architecture

See [Architecture Document](assets/docs/architecture-en.md).

Core layers:
- **Platform Adapter Layer**: Feishu Adapter / Discord Adapter
- **Entry & Routing Layer**: RootRouter / DiscordHandler
- **Domain Service Layer**: PermissionHandler / QuestionHandler / OutputBuffer / ChatSessionStore
- **OpenCode Integration Layer**: OpencodeClientWrapper / OpenCodeEventHub

<a id="quick-start"></a>
## 🚀 Quick Start

### 1) Run this command first (recommended)

Linux/macOS:

```bash
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
chmod +x ./scripts/deploy.sh
./scripts/deploy.sh guide
```

Windows PowerShell:

```powershell
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
.\scripts\deploy.ps1 guide
```

This command automatically:
- Detects Node.js / npm (provides installation guide if missing)
- Detects OpenCode installation and port status
- Can install OpenCode with one click (`npm i -g opencode-ai`)
- Installs project dependencies and compiles the bridge service
- If `.env` doesn't exist, automatically copies from `.env.example` (won't overwrite existing `.env`)
- Can input `FEISHU_APP_ID` / `FEISHU_APP_SECRET` directly in interactive phase (with undo/skip support)

**Note**:
- Running without `guide` suffix opens the menu.
- This command completes "deployment and environment preparation".
- Feishu credentials must be filled by you; the script won't write real credentials; service cannot receive Feishu messages without them.

### 2) Fill in Feishu configuration (required, skip if done in previous step)

```bash
cp .env.example .env
```

At minimum fill in:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

### 3) Start OpenCode (keep CLI interface)

```bash
opencode
```

### 4) Start the bridge service

Linux/macOS:

```bash
./scripts/start.sh
```

Windows PowerShell:

```powershell
.\scripts\start.ps1
```

For development debugging:

```bash
npm run dev
```

### 5) npm CLI installation (better for local continuous running scenarios)

```bash
npm install -g opencode-bridge
opencode-bridge
```

Detailed configuration see [Deployment & Ops Document](assets/docs/deployment-en.md).

<a id="deployment--ops"></a>
## 💻 Deployment & Ops

### Available commands after Node.js installed

| Goal | Command | Description |
|---|---|---|
| One-click deploy | `node scripts/deploy.mjs deploy` | Clean install by default, then install dependencies and compile |
| One-click upgrade | `node scripts/deploy.mjs upgrade` | Clean upgrade by default: uninstall/cleanup first, then pull and redeploy |
| Install/upgrade OpenCode | `node scripts/deploy.mjs opencode-install` | Run `npm i -g opencode-ai` |
| Check OpenCode environment | `node scripts/deploy.mjs opencode-check` | Check opencode command and port listening |
| Start OpenCode CLI | `node scripts/deploy.mjs opencode-start` | Auto-write `opencode.json` then run `opencode` in foreground |
| First-time guide | `node scripts/deploy.mjs guide` | Integrated flow for install/deploy/guide-start |
| Management menu | `npm run manage:bridge` | Interactive menu (default entry point) |
| Start background | `npm run start` | Start in background (auto-detect/supplement build) |
| Stop background | `node scripts/stop.mjs` | Stop background process by PID |

Detailed deployment instructions see [Deployment & Ops Document](assets/docs/deployment-en.md).

<a id="environment-variables"></a>
## ⚙️ Environment Variables

Core configuration:

| Variable | Required | Default | Description |
|---|---|---|---|
| `FEISHU_APP_ID` | Yes | - | Feishu App ID |
| `FEISHU_APP_SECRET` | Yes | - | Feishu App Secret |
| `OPENCODE_HOST` | No | `localhost` | OpenCode host address |
| `OPENCODE_PORT` | No | `4096` | OpenCode port |
| `DISCORD_ENABLED` | No | `false` | Enable Discord adapter |
| `DISCORD_TOKEN` | No | - | Discord Bot Token |

Full configuration see [Environment Variables Document](assets/docs/environment-en.md).

<a id="reliability-features"></a>
## 🛡️ Reliability Features (Heartbeat + Cron + Crash Rescue)

See [Reliability Guide](assets/docs/reliability-en.md).

### Quick Overview

- **Built-in Cron tasks**: `watchdog-probe` (30s), `process-consistency-check` (60s), `budget-reset` (daily 0:00)
- **Three management entry points**: HTTP API (`/cron/*`), Feishu (`/cron ...`), Discord (`///cron ...`)
- **Proactive heartbeat**: Configurable timer sends check prompts to Agent Session
- **Auto-rescue**: Auto-repair local OpenCode after consecutive failures reach threshold (loopback only)

### Minimum Configuration

```dotenv
RELIABILITY_CRON_ENABLED=true
RELIABILITY_CRON_API_ENABLED=true
RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED=false
RELIABILITY_LOOPBACK_ONLY=true
```

<a id="feishu-configuration"></a>
## ⚙️ Feishu Configuration

See [Feishu Configuration Document](assets/docs/feishu-config-en.md).

### Event Subscriptions

| Event | Required | Purpose |
|---|---|---|
| `im.message.receive_v1` | Yes | Receive group/private messages |
| `im.message.recalled_v1` | Yes | User undo triggers `/undo` rollback |
| `im.chat.member.user.deleted_v1` | Yes | Member leaves group, triggers lifecycle cleanup |
| `im.chat.disbanded_v1` | Yes | Group disbanded, cleanup local session mappings |
| `card.action.trigger` | Yes | Handle control panel, permission confirmation, question card callbacks |

### Application Permissions

Batch import permissions (save to `acc.json` then import in developer backend):

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

<a id="commands"></a>
## 📖 Commands

See [Commands Document](assets/docs/commands-en.md).

### Feishu Commands

| Command | Description |
|---|---|
| `/help` | View help |
| `/panel` | Open control panel |
| `/model <provider:model>` | Switch model |
| `/agent <name>` | Switch Agent |
| `/session new` | Start new topic |
| `/undo` | Undo last interaction |
| `/compact` | Compress context |
| `!<shell command>` | Pass through shell command |

### Discord Commands

| Command | Description |
|---|---|
| `///session` | View bound session |
| `///new` | Create and bind new session |
| `///bind <sessionId>` | Bind existing session |
| `///undo` | Undo last |
| `///compact` | Compress context |

<a id="agent-usage"></a>
## 🤖 Agent (Role) Usage

See [Agent Guide](assets/docs/agent-en.md).

### Quick Start

- View current Agent: `/agent`
- Switch Agent: `/agent <name>`
- Return to default: `/agent off`

### Custom Agent

```text
创建角色 名称=旅行助手; 描述=擅长制定旅行计划; 类型=主; 工具=webfetch
```

<a id="key-implementation-details"></a>
## 📌 Key Implementation Details

See [Implementation Document](assets/docs/implementation-en.md).

- Permission request callback: `response` is `once | always | reject`
- Question tool interaction: answers parsed from user text replies
- Stream and thinking cards: text and thinking分流写入 output buffer
- `/undo` consistency: delete Feishu message and execute `revert` on OpenCode simultaneously

<a id="troubleshooting"></a>
## 🛠️ Troubleshooting

See [Troubleshooting Document](assets/docs/troubleshooting-en.md).

| Symptom | Check First |
|---|---|
| No OpenCode response after sending Feishu message | Check Feishu permission configuration |
| No OpenCode response after clicking permission card | Confirm callback value is `once/always/reject` |
| `/compact` fails | Check available OpenCode models |
| Cannot stop background mode | Check if `logs/bridge.pid` is stale |

<a id="detailed-documentation"></a>
## 📚 Detailed Documentation

### Chinese Documentation

| Document | Description |
|---|---|
| [架构文档](assets/docs/architecture.md) | Project layering and platform capabilities |
| [环境变量](assets/docs/environment.md) | Complete environment configuration |
| [可靠性指南](assets/docs/reliability.md) | Heartbeat, Cron, and crash rescue |
| [飞书后台配置](assets/docs/feishu-config.md) | Event subscriptions and permissions |
| [命令速查](assets/docs/commands.md) | Complete command reference |
| [实现细节](assets/docs/implementation.md) | Key implementation details |
| [故障排查](assets/docs/troubleshooting.md) | Common issues and solutions |
| [部署运维](assets/docs/deployment.md) | Deployment and systemd setup |
| [Agent 使用](assets/docs/agent.md) | Role configuration and custom agents |
| [灰度部署](assets/docs/rollout.md) | Gray deployment and rollback SOP |
| [SDK API](assets/docs/sdk-api.md) | OpenCode SDK integration guide |
| [工作目录指南](assets/docs/workspace-guide.md) | Working directory strategy and project configuration |

### English Documentation

| Document | Description |
|---|---|
| [Architecture](assets/docs/architecture-en.md) | Project layering and platform capabilities |
| [Environment Variables](assets/docs/environment-en.md) | Complete environment configuration |
| [Reliability](assets/docs/reliability-en.md) | Heartbeat, Cron, and crash rescue |
| [Feishu Config](assets/docs/feishu-config-en.md) | Event subscriptions and permissions |
| [Commands](assets/docs/commands-en.md) | Complete command reference |
| [Implementation](assets/docs/implementation-en.md) | Key implementation details |
| [Troubleshooting](assets/docs/troubleshooting-en.md) | Common issues and solutions |
| [Deployment](assets/docs/deployment-en.md) | Deployment and systemd setup |
| [Agent Guide](assets/docs/agent-en.md) | Role configuration and custom agents |
| [Gray Deploy](assets/docs/rollout-en.md) | Gray deployment and rollback SOP |
| [SDK API](assets/docs/sdk-api-en.md) | OpenCode SDK integration guide |
| [Workspace Guide](assets/docs/workspace-guide-en.md) | Working directory strategy and project configuration |

<a id="license"></a>
## 📝 License

This project uses [GNU General Public License v3.0](LICENSE)

**GPL v3 means:**
- ✅ Free to use, modify, and distribute
- ✅ Can be used for commercial purposes
- 📝 Must open source modified versions
- 📝 Must retain original author copyright
- 📝 Derivative works must use GPL v3 license

If this project helps you, please give it a ⭐️ Star!
