# 飞书 × OpenCode 桥接服务
通过飞书聊天控制本地的 OpenCode，类似 OpenClaw 的功能实现。

## AI 部署指南

如果您是一名 AI 代理，您只需阅读 `AI_Deployment_Guide.md` 文档，即可自行部署和运行此服务。

现在，你应该学会用 AI 干活了，在你的 OpenCode 中输入如下指令，让它帮你安装吧：

```bash
# 请复制以下指令发送给 AI 代理：
请读取 https://github.com/HNGM-HP/feishu-opencode-bridge/blob/main/AI_Deployment_Guide.md 并按照文档内容完成本项目的部署和启动。
```
## 功能特性

- ✅ **消息收发**: 通过飞书发送指令，OpenCode 执行后返回结果
- ✅ **权限确认**: 支持卡片按钮、文本回复、预设白名单三种方式
- ✅ **中断执行**: 发送 `/stop` 立即中断当前任务
- ✅ **智能撤回**: 发送 `/undo` 撤回 OpenCode 操作状态并同步撤回飞书消息
- ✅ **控制面板**: 发送 `/panel` 唤起交互式面板，可视化切换模型/Agent及控制执行
- ✅ **切换模型**: 发送 `/model <名称>` 动态切换模型，支持厂商前缀显示
- ✅ **切换 Agent**: 发送 `/agent <名称>` 动态切换 Agent
- ✅ **会话管理**: 支持新建、切换、列出对话
- ✅ **输出缓冲**: 智能输出缓冲，避免重复发送
- ✅ **延迟响应处理**: 自动处理 OpenCode 的延迟响应
- ✅ **AI 提问**: 支持 AI 向用户提问的场景，支持多题连续交互
- ✅ **附件支持**: 通过 Data URL 方式传输附件，无需本地文件服务
- ✅ **流式输出**: 实时显示 AI 执行过程（思考、工具状态）
- ✅ **用户白名单**: 限制只有指定用户可以使用
- ✅ **定时清理**: 定期清理超时的响应，防止资源泄漏

## 技术架构

### 消息处理流程

```
用户消息 → 权限验证 → 命令解析 → OpenCode 执行 → 输出缓冲 → 飞书回复
```

### 会话模式

支持三种会话模式：
- **Thread 模式**: 群内会话（`thread:{threadId}`）
- **User 模式**: 私聊会话（`user:{userId}`）
- **Chat 模式**: 会话群模式（`chat:{chatId}`）

私聊模式下会自动创建会话群，消息转入群内处理。

### 权限确认机制

当 OpenCode 需要执行敏感操作时，系统会发送权限确认卡片：
- **卡片按钮**: 用户点击允许/拒绝按钮
- **文本回复**: 用户回复 `y` 或 `n` 确认
- **白名单**: 预设的工具白名单自动通过，无需确认

### 延迟响应处理

OpenCode 可能会延迟返回响应（如需要额外处理），系统会：
1. 自动等待延迟响应（最长 2 分钟）
2. 收到响应后自动发送给用户
3. 超时发送提醒消息
4. 定期清理超时的等待（每分钟清理一次）

### AI 提问处理

当 AI 需要用户输入时：
1. 发送问题卡片到飞书
2. 用户可通过卡片选项或直接回复文本回答
3. 支持多题连续交互
4. 回答后自动提交给 OpenCode
5. 超时自动过期处理

### 附件处理

- 支持图片、文档等多种格式
- 转换为 Data URL 格式
- 直接传输给 OpenCode，无需本地文件服务

### 输出缓冲机制

为了防止飞书 API 限流，实现智能输出缓冲：
- 输出先存入缓冲区
- 定期合并更新（默认 3 秒一次）
- 避免短时间内大量消息轰炸

### 优雅退出

服务支持优雅退出，确保资源正确清理：
- 捕获 SIGINT、SIGTERM、SIGUSR2 信号
- 依次停止飞书连接、OpenCode 连接
- 清理所有缓冲区、定时器和挂起的请求
- 确保数据持久化完成后退出

## 前置要求

### 运行环境
- Node.js >= 20.0.0
- npm 包管理器

### 飞书应用配置

登录 [飞书开发者后台](https://open.feishu.cn/app) 进行配置：

#### 1. 创建自建应用

如果您尚未创建应用，请点击 **“创建应用”**，选择 **“企业自建应用”** 或 **“商店应用”** (根据实际需求)，并填写应用基本信息。

#### 2. 添加机器人能力

- 在应用详情页左侧导航栏，点击 **“功能模块”** -> **“机器人”**。
- 开启 **“机器人能力”**。
- 保存并发布。

#### 3. 配置事件订阅

- 在应用详情页左侧导航栏，点击 **“事件订阅”**。
- **订阅方式** 选择 **“长连接”**。
- **添加事件**：
  - `im.message.receive_v1` (接收用户消息，机器人需要回复)
  - `card.action.trigger` (接收卡片交互事件，用于权限确认、AI 提问等)
  - `im.message.recalled_v1` (监听消息撤回，用于同步撤回 OpenCode 操作)
  - `im.chat.member.user.deleted_v1` (监听用户离开群，用于清理会话)
  - `im.chat.disbanded_v1` (监听群解散，用于清理会话)
  - `im.chat.member.bot.deleted_v1` (监听机器人被移除，用于清理会话)
- 保存并发布。

#### 4. 添加权限

- 在应用详情页左侧导航栏，点击 **“权限管理”**。
- 搜索并开通以下权限：
  - `im:message:send_as_bot` (以应用身份发送消息)
  - `im:message` (管理消息，包括更新卡片、撤回消息等)
  - `im:message:readonly` (读取消息，用于获取用户指令、历史消息等)
  - `im:chat:read.single` (获取用户所在群聊信息，用于会话群管理)
  - `im:chat:write.group` (管理群聊，用于私聊时自动创建会话群)
  - `im:chat:read.group` (读取群聊基础信息)
  - `contact:contact:readonly` (读取通讯录基本信息，用于获取用户 open_id)
- 保存并发布。

#### 5. 发布应用

- 在应用详情页左侧导航栏，点击 **“版本管理与发布”**。
- 创建新版本，填写版本信息，然后点击 **“申请发布”**。
- 待管理员审核通过后，应用即可上线使用。

## 安装

```bash
cd feishu-opencode-bridge
npm install
```

## 配置

复制 `.env.example` 为 `.env` 并填写配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 飞书应用配置（从开发者后台获取）
FEISHU_APP_ID=cli_xxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# 用户白名单（你的飞书 open_id）
ALLOWED_USERS=ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 默认模型
DEFAULT_PROVIDER=anthropic
DEFAULT_MODEL=claude-sonnet-4-20250514

# 自动允许的工具（不需要确认）
TOOL_WHITELIST=Read,Glob,Grep,Task,Write

# 输出配置
OUTPUT_UPDATE_INTERVAL=3000

# 延迟响应最大等待时间（毫秒）
MAX_DELAYED_RESPONSE_WAIT_MS=120000
```

### 获取你的 open_id

1. 在飞书客户端给机器人发一条消息
2. 查看服务运行日志，会显示发送者的 open_id

### OpenCode 服务配置（可选）

您可以修改 OpenCode 的配置文件 `config.json`，以免去每次启动时手动指定端口参数。

**路径**：
- Windows: `C:\Users\{用户名}\.config\opencode\config.json`
- Linux/macOS: `~/.config/opencode/config.json`

**配置内容**：

```json
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0",
    "cors": [
      "*"
    ]
  }
```

## 运行

### 1. 启动 OpenCode 服务

在一个终端窗口运行：

```bash
opencode serve --port 4096
```

或者直接运行 OpenCode（它会自动启动服务）：

```bash
opencode --port 4096
```

### 2. 启动桥接服务

在另一个终端窗口运行：

```bash
npm run dev
```

## 使用方法

### 发送消息给 AI

直接输入文字，机器人会转发给 OpenCode 执行

### 控制命令

| 命令 | 功能 |
|------|------|
| `/panel` | **打开控制面板 (推荐)**，可视化切换模型/Agent、停止、撤回 |
| `/stop` | 中断当前执行 |
| `/undo` | **智能撤回**，回滚 OpenCode 状态并删除最近的飞书消息 |
| `/abort` | 取消当前操作 |
| `/model <名称>` | 切换模型（如 `/model claude-4`） |
| `/model` | 查看当前模型 |
| `/model list` | 列出可用模型 |
| `/agent <名称>` | 切换 Agent（如 `/agent default`） |
| `/agent` | 查看当前 Agent |
| `/agent list` | 列出可用 Agent |
| `/session new` | 创建新对话 |
| `/session <id>` | 切换到指定对话 |
| `/sessions` | 列出所有对话 |
| `/clear` | 清空当前对话 |
| `/status` | 查看当前状态 |
| `/help` | 显示帮助 |

### 权限确认

当 OpenCode 需要执行敏感操作时：
- 点击卡片上的按钮
- 或直接回复 `y` / `n`

## 项目结构

```
src/
├── index.ts              # 入口文件，主流程控制与优雅退出
├── config.ts             # 配置管理与验证
├── commands/
│   └── parser.ts         # 命令解析器
├── feishu/
│   ├── client.ts         # 飞书 SDK 封装与长连接管理
│   ├── cards.ts          # 消息卡片模板（权限、问题、流式输出、控制面板）
│   ├── streamer.ts       # 流式卡片更新器
│   └── attachment.ts     # 附件处理（Data URL 转换）
├── opencode/
│   ├── client.ts         # OpenCode SDK 封装与 SSE 事件监听
│   ├── output-buffer.ts  # 智能输出缓冲
│   ├── delayed-handler.ts # 延迟响应处理器
│   └── question-handler.ts # AI 提问处理器
├── handlers/
│   ├── command.ts        # 统一命令处理器 (/panel, /undo 等)
│   ├── card-action.ts    # 卡片交互处理器（模型/Agent 选择）
│   ├── group.ts          # 群聊消息处理器
│   ├── p2p.ts            # 私聊消息处理器
│   └── lifecycle.ts      # 生命周期处理器 (群组、权限、退出清理)
├── permissions/
│   └── handler.ts        # 工具白名单与权限处理
└── store/
    ├── user-session.ts   # 用户会话持久化存储
    ├── chat-session.ts   # 聊天会话状态存储
    ├── session-group.ts  # 会话群映射（私聊→群）
    └── session-directory.ts # 会话目录映射
```

## 开发

```bash
# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 生产运行
npm start
```

## 常见问题

### 收不到消息？

1. 检查飞书后台是否选择了"长连接"订阅方式
2. 检查是否添加了 `im.message.receive_v1` 事件
3. 检查应用是否已发布
4. 检查 App ID 和 App Secret 是否正确

### 连接 OpenCode 失败？

1. 确保 `opencode serve` 已在运行
2. 检查端口是否正确（默认 4096）
3. 检查防火墙设置

### 没有权限使用？

1. 检查 `.env` 中的 `ALLOWED_USERS` 配置
2. 留空表示不限制用户

## 监控与日志

服务运行日志会输出到控制台，包含：
- `[飞书]` - 飞书相关操作
- `[OpenCode]` - OpenCode 相关操作
- `[权限]` - 权限处理
- `[问题]` - AI 提问处理
- `[延迟响应]` - 延迟响应处理
- `[会话群]` - 会话群管理
- `[SSE]` - Server-Sent Events 连接
- `[CardAction]` - 卡片交互事件

## License

MIT
