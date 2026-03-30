# OpenCode Bridge Architecture

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Architecture Overview

OpenCode Bridge is a multi-platform messaging bridge that connects IM platforms (Feishu, Discord, WeCom, Telegram, QQ, WhatsApp, WeChat) with OpenCode AI assistant.

### Design Principles

- **Consistent Task Closure**: Unified message/permission/question/streaming/rollback across all platforms
- **Platform Boundaries**: Respect platform-specific interaction paradigms; no forced UI reuse
- **Directory Consistency**: Ensure session and working directory alignment
- **Layered Architecture**: Support future platform expansion and gray evolution

---

## 2. Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Platform Adapter Layer                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Feishu    │  │   Discord    │  │    WeCom     │  ...      │
│  │   Adapter   │  │   Adapter    │  │   Adapter    │           │
│  └─────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Ingress Routing Layer                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  RootRouter  │  Platform Handlers  │  Action Handlers   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Domain Processing Layer                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │Permission│ │ Question │ │OutputBuffer  │ │ChatSession    │  │
│  │ Handler  │ │ Handler  │ │              │ │ Store         │  │
│  └──────────┘ └──────────┘ └──────────────┘ └───────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │        DirectoryPolicy  │  LifecycleHandler              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenCode Integration Layer                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │     OpencodeClientWrapper  │  OpenCodeEventHub           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Reliability Layer                         │
│  ┌──────────────┐ ┌───────────────┐ ┌─────────────────────┐    │
│  │CronScheduler │ │RuntimeCron    │ │RescueOrchestrator   │    │
│  │              │ │Manager        │ │                     │    │
│  └──────────────┘ └───────────────┘ └─────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           ConversationHeartbeat (Session Keepalive)      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Management Layer                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │     AdminServer (Web Panel)  │  BridgeManager            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Module Responsibilities

### 3.1 Platform Adapter Layer

| Module | File | Responsibility |
|--------|------|----------------|
| Feishu Adapter | `src/platform/adapters/feishu-adapter.ts` | Feishu event reception, unified event model conversion |
| Discord Adapter | `src/platform/adapters/discord-adapter.ts` | Discord gateway messages, component interactions |
| WeCom Adapter | `src/platform/adapters/wecom-adapter.ts` | WeCom event reception, unified event model conversion |
| Telegram Adapter | `src/platform/adapters/telegram-adapter.ts` | Telegram bot messages, inline keyboard interactions |
| QQ Adapter | `src/platform/adapters/qq-adapter.ts` | QQ OneBot protocol message handling |
| WhatsApp Adapter | `src/platform/adapters/whatsapp-adapter.ts` | WhatsApp personal/business message handling |
| WeChat Adapter | `src/platform/adapters/weixin-adapter.ts` | WeChat personal account message handling |

### 3.2 Ingress Routing Layer

| Module | File | Responsibility |
|--------|------|----------------|
| RootRouter | `src/router/root-router.ts` | Unified entry point for multi-platform messages and card actions |
| Platform Handlers | `src/handlers/` | Command parsing, panels, permissions/questions, message routing |
| Action Handlers | `src/router/action-handlers.ts` | Decouples permission/question action callbacks from entry point |

### 3.3 Domain Processing Layer

| Module | File | Responsibility |
|--------|------|----------------|
| PermissionHandler | `src/permissions/handler.ts` | Permission queues, whitelist decisions, dequeue, timeout cleanup |
| QuestionHandler | `src/opencode/question-handler.ts` | Question state management (multi-question, skip, submission) |
| OutputBuffer | `src/opencode/output-buffer.ts` | Stream fragment aggregation, throttling, state markers |
| ChatSessionStore | `src/store/chat-session.ts` | `platform:conversationId` namespace mapping, session aliases |
| DirectoryPolicy | `src/utils/directory-policy.ts` | Directory security policies, whitelist constraints, Git root normalization |
| LifecycleHandler | `src/handlers/lifecycle.ts` | Lifecycle scanning, cleanup, dismissal logic |

### 3.4 OpenCode Integration Layer

| Module | File | Responsibility |
|--------|------|----------------|
| OpencodeClientWrapper | `src/opencode/client.ts` | Unified encapsulation for sessions/messages/commands/permissions/questions |
| OpenCodeEventHub | `src/router/opencode-event-hub.ts` | Single entry point for OpenCode events, distributed to permissions, questions, output |

### 3.5 Reliability Layer

| Module | File | Responsibility |
|--------|------|----------------|
| CronScheduler | `src/reliability/scheduler.ts` | Cron scheduler, manages scheduled tasks |
| RuntimeCronManager | `src/reliability/runtime-cron.ts` | Runtime Cron manager, supports dynamic creation and management |
| RescueOrchestrator | `src/reliability/rescue-executor.ts` | Crash rescue executor, automatically repairs local OpenCode |
| ConversationHeartbeat | `src/reliability/conversation-heartbeat.ts` | Session heartbeat engine, keeps sessions active |

### 3.6 Management Layer

| Module | File | Responsibility |
|--------|------|----------------|
| AdminServer | `src/admin/admin-server.ts` | Web configuration center server, REST API and static file services |
| BridgeManager | `src/admin/bridge-manager.ts` | Bridge service manager, controls service lifecycle |

---

## 4. Key Workflows

### 4.1 Message Flow (Inbound → OpenCode)

```
Platform Message
       ▼
Adapter Normalization
       ▼
RootRouter (command parsing, session location)
       ▼
Assemble Parameters (model, role, effort, directory)
       ▼
opencodeClient.sendMessage*()
       ▼
OpenCode Server
```

### 4.2 Event Flow (OpenCode → Outbound)

```
OpenCode Event Stream
       ▼
OpenCodeEventHub (messagePartUpdated / sessionStatus / ...)
       ▼
OutputBuffer (aggregate + throttle)
       ▼
Platform-Specific Rendering:
  ├── Feishu: Card streaming updates
  ├── Discord: Text/component updates
  └── WeCom: Text updates
```

### 4.3 Permission Closure Flow

```
permission.asked Event
       ▼
Whitelist Check (TOOL_WHITELIST)
       ▼
┌─────────────┬─────────────┐
│  Match      │  No Match   │
│  Auto-Allow │  Queue Wait │
└─────────────┴─────────────┘
       ▼
Manual Confirmation (Card Action or Text Fallback)
       ▼
respondToPermission() with Directory Awareness
       ▼
Directory Candidates Fallback (current → known → default)
```

### 4.4 Reliability Flow

```
Bridge Startup
       ▼
Load Built-in Cron Tasks
       ▼
Start Heartbeat Timer (if enabled)
       ▼
┌─────────────────────────────────────┐
│  Health Probe (every 30 seconds)    │
│  Process Consistency (every 60s)    │
│  Stale Cleanup (every 5 minutes)    │
└─────────────────────────────────────┘
       ▼
Failure Threshold Reached?
       ▼
┌─────────────┬─────────────┐
│  Yes        │  No         │
│  Rescue     │  Continue   │
└─────────────┴─────────────┘
```

---

## 5. Directory Consistency Strategy

### Directory Priority Chain

```
1. Explicit Input (command argument / card input)
          ↓
2. Project Aliases (PROJECT_ALIASES)
          ↓
3. Group Default (session binding storage)
          ↓
4. Global Default (DEFAULT_WORK_DIRECTORY)
          ↓
5. OpenCode Server Default
```

### Permission Response Directory Candidates

Permission responses carry directory information to reduce "logs show success but tasks stuck" issues:

1. **Priority**: Current session directory
2. **Fallback**: Known directory list
3. **Final**: Default directory instance

### Security Validation Flow

```
Path Input
       ▼
1. Path Format & Length Check
       ▼
2. Dangerous Path Interception
       ▼
3. Whitelist Check (ALLOWED_DIRECTORIES)
       ▼
4. Existence & Accessibility Check
       ▼
5. realpath Resolution + Secondary Whitelist
       ▼
6. Git Root Normalization + Recheck
       ▼
Return Validated Path
```

---

## 6. Platform Boundary Principles

### Independence

- Feishu, Discord, WeCom, Telegram, QQ, WhatsApp, WeChat are **independent platforms**
- No cross-platform UI component borrowing
- No cross-platform session semantic reuse

### Common Logic

- Common logic pushed down to domain layer (permissions, questions, session mapping, directory policies)
- Platform differences remain at ingress layer and adapter layer (cards/components/text interactions)

---

## 7. Configuration Storage Architecture

### Storage Strategy

| Storage | Purpose | Content |
|---------|---------|---------|
| `.env` | Startup Parameters | `ADMIN_PORT`, `ADMIN_PASSWORD` only |
| SQLite (`data/config.db`) | Business Configuration | All platform configs, reliability settings, display controls |

### Migration Flow

```
First Startup
       ▼
Detect business config in .env
       ▼
Migrate to SQLite database
       ▼
Backup original .env as .env.backup
       ▼
Migration Complete
```

### Configuration Modification

| Method | Description |
|--------|-------------|
| Web Panel | Access `http://localhost:4098` for visual modification (recommended) |
| SQLite Tool | Directly edit `data/config.db` database |
| .env File | Configure before first startup (auto-migrates on first run) |

---

## 8. Router Modes

### Mode Comparison

| Mode | Description | Use Case | Risk |
|------|-------------|----------|------|
| `legacy` | Legacy direct routing | Default, stable production | 🟢 Low |
| `dual` | Dual-track (logging comparison) | Gray testing phase | 🟡 Medium |
| `router` | New root router | Full deployment after validation | 🟢 Low |

### Configuration

```bash
# Temporary (command line)
ROUTER_MODE=legacy node scripts/start.mjs
ROUTER_MODE=dual node scripts/start.mjs
ROUTER_MODE=router node scripts/start.mjs

# Permanent (.env file)
echo "ROUTER_MODE=dual" >> .env
```

### Gray Release Phases

```
Legacy Mode → Dual Mode → Router Mode → Full Deployment
              ↓              ↓
           Observe 24h    No Issues
```

---

## 9. Runtime and Troubleshooting

### First Checks

1. **Router Mode**: Check startup logs for `路由器模式：xxx`
2. **Platform Enablement**: Verify platform adapters are enabled
3. **Session Mapping**: Check `platform:conversationId` bindings
4. **Permission Queue**: Verify queue status and session bindings

### Common Issues

| Issue | Priority Check |
|-------|----------------|
| Permission stuck | Queue key, session binding, directory candidates |
| Card rendering failed | Routing action entered handler, platform capability restrictions |
| Reliability not working | Cron task status, heartbeat config, rescue strategy |
| Directory validation failed | ALLOWED_DIRECTORIES, realpath resolution, Git root normalization |

### Build and Test

After modifying core workflows:

```bash
npm run build
npm test
```

---

## 10. Future Extension Points

### Adding New Platforms

1. Create adapter in `src/platform/adapters/`
2. Implement unified event model conversion
3. Implement `PlatformSender` interface
4. Register in router and management layer

### Enhancement Areas

- Converge more cross-platform capabilities into `action-handlers` and `event-hub`
- Enhance directory instance self-healing capabilities
- Improve permission retry observability
- Extend reliability layer with more rescue strategies and monitoring metrics

---

## 11. File Structure Reference

```
src/
├── index.ts                          # Main entry point
├── config.ts                         # Configuration entry point
├── platform/
│   └── adapters/
│       ├── feishu-adapter.ts
│       ├── discord-adapter.ts
│       ├── wecom-adapter.ts
│       ├── telegram-adapter.ts
│       ├── qq-adapter.ts
│       ├── whatsapp-adapter.ts
│       └── weixin-adapter.ts
├── router/
│   ├── root-router.ts
│   ├── action-handlers.ts
│   └── opencode-event-hub.ts
├── handlers/
│   ├── feishu.ts
│   ├── discord.ts
│   ├── telegram.ts
│   └── lifecycle.ts
├── permissions/
│   └── handler.ts
├── opencode/
│   ├── client.ts
│   ├── question-handler.ts
│   └── output-buffer.ts
├── store/
│   └── chat-session.ts
├── utils/
│   ├── directory-policy.ts
│   ├── text-builder.ts
│   └── logger.ts
├── reliability/
│   ├── scheduler.ts
│   ├── runtime-cron.ts
│   ├── rescue-executor.ts
│   └── conversation-heartbeat.ts
└── admin/
    ├── admin-server.ts
    └── bridge-manager.ts
```
