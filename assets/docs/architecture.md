# OpenCode 桥接项目架构概览

## 一、项目整体目录结构

```
D:\feishu-opencode-bridge\
├── .env                          # 环境变量（实际配置）
├── .env.example                  # 环境变量模板
├── .gitignore
├── .chat-sessions.json           # 运行时持久化：群聊-会话绑定
├── .user-sessions.json           # 运行时持久化：用户-会话映射
├── .session-directories.json     # 会话-工作目录映射
├── .session-groups.json          # 用户-群组映射
├── AGENTS.md                     # AI 代理开发指南
├── AI_Deployment_Guide.md        # 部署指南
├── LICENSE                       # GPLv3
├── README.md
├── package.json                  # 项目配置 & 脚本
├── package-lock.json
├── tsconfig.json
│
├── assets/
│   └── opencode-agents/          # OpenCode 预设角色 Markdown
│       ├── bridge-emotional-support.md
│       ├── bridge-legal-assistant.md
│       └── bridge-personal-assistant.md
│
├── scripts/                      # 部署/启停脚本（多平台）
│   ├── deploy.mjs / deploy.cmd / deploy.sh / deploy.ps1
│   ├── start.mjs / start.cmd / start.sh / start.ps1
│   └── stop.mjs / stop.cmd / stop.sh / stop.ps1
│
└── src/                          # ========= 核心源码 =========
    ├── index.ts                  # 【入口 & 路由调度】
    ├── config.ts                 # 全局配置（飞书/OpenCode/权限/输出等）
    │
    ├── commands/                 # 命令解析层
    │   └── parser.ts             # 斜杠命令解析器 & 帮助文本
    │
    ├── handlers/                 # 事件处理层（Handler）
    │   ├── command.ts            # 命令统一执行器（模型/角色/会话/undo/panel 等）
    │   ├── p2p.ts                # 私聊消息处理器
    │   ├── group.ts              # 群聊消息处理器
    │   ├── card-action.ts        # 飞书卡片按钮动作处理器
    │   └── lifecycle.ts         # 生命周期管理（群清理/成员退出/解散）
    │
    ├── feishu/                   # 飞书 SDK 封装层
    │   ├── client.ts             # 飞书 API 客户端（消息/群/卡片/事件等）
    │   ├── cards.ts              # 飞书卡片模板（权限/状态/控制面板/提问/欢迎）
    │   ├── cards-stream.ts       # 流式输出卡片构建
    │   └── streamer.ts           # 卡片流式更新器（节流推送）
    │
    ├── opencode/                 # OpenCode SDK 封装层
    │   ├── client.ts             # OpenCode API 客户端（会话/消息/命令/权限/SSE）
    │   ├── output-buffer.ts      # 输出缓冲区（聚合流式输出，定时推送飞书）
    │   ├── session-queue.ts      # 会话请求队列（保证同会话消息串行）
    │   ├── delayed-handler.ts    # 延迟响应处理器（超时后通过 SSE 收到的迟到响应）
    │   ├── question-handler.ts   # AI 提问处理器（管理待回答问题状态）
    │   └── question-parser.ts    # 问题答案文本解析器
    │
    ├── permissions/              # 权限管理层
    │   └── handler.ts            # 工具权限白名单 & 待处理权限请求管理
    │
    ├── store/                    # 数据持久化层
    │   ├── chat-session.ts       # 【核心】群聊 <-> OpenCode会话 绑定存储
    │   ├── user-session.ts       # 用户 <-> 会话列表 映射存储
    │   ├── session-directory.ts  # 会话 <-> 工作目录 映射存储
    │   └── session-group.ts      # 用户 <-> 群组 映射存储
    │
    └── utils/                    # 工具层
        └── async-queue.ts        # 通用异步串行队列
```

## 二、入口文件与路由/调度

### 入口文件: `src/index.ts` (910 行)

这是整个项目的核心调度中枢，`main()` 函数按以下步骤启动：

1. **验证配置** (`validateConfig()`)
2. **连接 OpenCode** (`opencodeClient.connect()`)
3. **配置输出缓冲** — 设置 `outputBuffer.setUpdateCallback()` 将流式输出聚合后推送为飞书卡片
4. **监听飞书消息** — 按 `chatType` 分发到 `p2pHandler` 或 `groupHandler`
5. **监听飞书卡片动作** — `setCardActionHandler` 处理按钮回调，按 action 类型分发：
   - `create_chat` → `p2pHandler.handleCardAction`
   - `permission_allow/deny` → 直接调用 `opencodeClient.respondToPermission`
   - `question_skip` → `groupHandler.handleQuestionSkipAction`
   - 其他 → `cardActionHandler.handle`
6. **监听 OpenCode 事件**:
   - `permissionRequest` → 白名单检查或发送权限确认卡片
   - `sessionStatus` → 重试提示 / 完成标记
   - `sessionIdle` → 完成兜底
   - `sessionError` → 错误显示
   - `messageUpdated` → 记录 openCodeMsgId / 处理 assistant error
   - `messagePartUpdated` → 流式输出（文本/思考/工具/subtask/retry/compaction）
   - `questionAsked` → 发送提问卡片
7. **监听生命周期事件** — 成员退群 / 群解散 / 消息撤回（触发 undo）
8. **启动飞书客户端** (`feishuClient.start()`)
9. **启动清理检查** (`lifecycleHandler.cleanUpOnStart()`)
10. **优雅退出处理** — SIGINT/SIGTERM/SIGUSR2 信号

## 三、核心模块职责

### 1. 命令解析层 (`src/commands/parser.ts`)

**核心函数**: `parseCommand(text: string): ParsedCommand`

**支持的命令类型**:
- `/stop`, `/abort`, `/cancel` → 中断执行
- `/undo`, `/revert` → 撤回上一步
- `/model [name]` → 切换/查看模型
- `/agent [name]` → 切换/查看角色
- `/role [create ...]`, `/角色` → 角色操作
- `/session [new|list|<id>]` → 会话管理
- `/sessions`, `/list` → 列出会话
- `/clear [free session]`, `/reset` → 清空上下文
- `/panel`, `/controls` → 控制面板
- `/make_admin`, `/add_admin` → 管理员
- `/help`, `/h`, `/?` → 帮助
- `/status` → 状态
- **其他任何 `/xxx` 未知命令** → 透传到 OpenCode

### 2. 命令执行层 (`src/handlers/command.ts`)

**核心类**: `CommandHandler`

**`handle()` 方法** — 统一命令分发：
```
help → 回复帮助文本
status → handleStatus()
session → handleNewSession() / handleListSessions()
clear → handleClearFreeSession() / handleNewSession()
stop → opencodeClient.abortSession()
command → handlePassthroughCommand() (透传到 OpenCode)
model → handleModel()
agent → handleAgent()
role → handleRoleCreate()
undo → handleUndo()
panel → handlePanel() / pushPanelCard()
sessions → handleListSessions()
default → handlePassthroughCommand()
```

### 3. 消息处理层

**私聊处理器 (`src/handlers/p2p.ts`)**:
- 首次私聊引导
- 建群快捷命令
- 命令解析与执行

**群聊处理器 (`src/handlers/group.ts`)**:
- 命令解析与执行
- 问题回答处理
- 发送到 OpenCode

### 4. 数据持久化层

**群聊-会话绑定** (`src/store/chat-session.ts`):
- `chatId` ↔ `sessionId` 双向映射
- 交互历史管理（最多20条）
- 配置存储（模型/角色偏好）

**用户-会话映射** (`src/store/user-session.ts`):
- 用户当前会话
- 用户会话列表

**会话-目录映射** (`src/store/session-directory.ts`):
- `sessionId` → 工作目录路径

**用户-群组映射** (`src/store/session-group.ts`):
- 用户活跃群聊
- 群组列表

### 5. SDK 封装层

**飞书 SDK** (`src/feishu/client.ts`):
- 飞书 API 客户端
- 卡片构建与更新
- 消息发送与接收

**OpenCode SDK** (`src/opencode/client.ts`):
- OpenCode API 客户端
- 会话管理
- 流式输出处理
- SSE 事件监听

## 四、架构总结

该项目是一个 **飞书机器人 ↔ OpenCode AI** 的桥接服务，核心架构：

```
飞书用户消息
    │
    ▼
src/index.ts (入口/路由调度)
    ├── p2p消息 → handlers/p2p.ts → 首次引导/建群/命令/普通消息
    ├── group消息 → handlers/group.ts → 命令/问题回答/发送到OpenCode
    ├── 卡片动作 → handlers/card-action.ts → 停止/撤回/切模型/切角色
    └── 生命周期 → handlers/lifecycle.ts → 群清理/成员退出
         │
         ▼
    commands/parser.ts (解析斜杠命令)
    handlers/command.ts (执行命令)
         │
         ▼
    opencode/client.ts (与OpenCode通信)
         │  ├── 同步/异步发送消息
         │  ├── SSE 事件流 → 流式输出/权限/提问/状态
         │  └── 命令透传
         │
         ▼
    opencode/output-buffer.ts → feishu/cards-stream.ts → 飞书卡片更新
    store/chat-session.ts (持久化绑定关系)
```

**关键设计模式**:
- 单例模式：所有 client/store/handler 均为全局单例导出
- 事件驱动：飞书 SDK EventDispatcher + OpenCode SSE EventEmitter
- 流式输出：OutputBuffer 聚合 → 定时回调 → 飞书卡片更新
- 命令模式：parser 解析 → command handler 统一分发执行
- 双向映射：chatId ↔ sessionId 通过 ChatSessionStore 双向查找