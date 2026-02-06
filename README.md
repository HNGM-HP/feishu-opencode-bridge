# 飞书 × OpenCode 桥接服务

通过飞书聊天控制本地的 OpenCode，类似 OpenClaw 的功能实现。

## 功能特性

- ✅ **消息收发**: 通过飞书发送指令，OpenCode 执行后返回结果
- ✅ **权限确认**: 支持卡片按钮、文本回复、预设白名单三种方式
- ✅ **中断执行**: 发送 `/stop` 立即中断当前任务
- ✅ **切换模型**: 发送 `/model <名称>` 动态切换模型
- ✅ **会话管理**: 支持新建、切换、列出对话
- ✅ **定时更新**: 执行过程中定时更新输出（默认3秒）
- ✅ **用户白名单**: 限制只有指定用户可以使用

## 前置要求

1. Node.js >= 20.0.0
2. 已创建并配置好的飞书自建应用
3. OpenCode 已安装并可运行

## 飞书应用配置

1. 登录 [飞书开发者后台](https://open.feishu.cn/app)
2. 选择你的应用，进行以下配置：

### 添加机器人能力
- 应用功能 → 添加应用能力 → 机器人

### 配置事件订阅
- 事件与回调 → 订阅方式 → **选择"长连接"**
- 添加事件：
  - `im.message.receive_v1` (接收消息)
  - `card.action.trigger` (卡片回调，可选)

### 添加权限
- 权限管理 → 开通权限：
  - `im:message:send_as_bot` (发送消息)
  - `im:message` (更新消息)
  - `im:message:readonly` (读取消息)

### 发布应用
- 版本管理与发布 → 创建版本 → 发布

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
TOOL_WHITELIST=Read,Glob,Grep,Task
```

### 获取你的 open_id

1. 在飞书客户端给机器人发一条消息
2. 查看服务运行日志，会显示发送者的 open_id

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

在飞书客户端找到你的机器人，发送消息即可：

### 发送指令给 AI
直接输入文字，机器人会转发给 OpenCode 执行

### 控制命令

| 命令 | 功能 |
|------|------|
| `/stop` | 中断当前执行 |
| `/model <名称>` | 切换模型（如 `/model claude-4`） |
| `/model` | 查看当前模型 |
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
├── index.ts              # 入口文件
├── config.ts             # 配置管理
├── feishu/
│   ├── client.ts         # 飞书 SDK 封装
│   └── cards.ts          # 消息卡片模板
├── opencode/
│   ├── client.ts         # OpenCode SDK 封装
│   └── output-buffer.ts  # 输出缓冲
├── commands/
│   └── parser.ts         # 命令解析
├── permissions/
│   └── handler.ts        # 权限处理
└── store/
    └── user-session.ts   # 用户会话存储
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

## License

MIT
