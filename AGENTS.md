# AGENTS.md

面向自动化编码代理的工作指南。

## 最近更新 (2025-02-06)

### ✅ 功能梳理完成

已全面梳理项目代码实现的功能，更新 README.md 和本文档，使其更准确反映项目特性。

主要改进：
- 添加会话群、会话目录等新功能描述
- 完善延迟响应处理机制
- 添加 AI 提问处理说明
- 完善附件处理说明
- 更新技术架构描述
- 补充命令类型说明

## 规则来源

- 已检查：`.cursor/rules/`、`.cursorrules`、`.github/copilot-instructions.md`
- 结果：未发现 Cursor / Copilot 规则文件

## 环境与运行前提

- 运行环境：Node.js >= 20（见 `package.json` engines）
- 语言：TypeScript（ESM，`type: module`）
- 编译配置：`tsconfig.json`（`module: NodeNext`，`strict: true`）

## 常用命令

### 安装

- 安装依赖：`npm install`

### 开发

- 开发模式（热重载）：`npm run dev`

### 构建

- 构建：`npm run build`

### 运行

- 生产运行：`npm start`
- 启动桥接服务（PowerShell 脚本）：`npm run start:bridge`
- 停止桥接服务（PowerShell 脚本）：`npm run stop:bridge`

### OpenCode 配置

OpenCode 配置文件位于 `~/.config/opencode/config.json`。
建议添加 `server` 配置以固定端口：

```json
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0",
    "cors": [
      "*"
    ]
  }
```

### Lint

- 未配置 lint 命令（`package.json` 无相关脚本）

### Test

- 未配置测试框架与测试脚本
- 单测运行：无（当前仓库不存在单测命令）

## 项目结构速览

- `src/index.ts`：入口与主流程控制、消息/卡片处理、延迟响应、AI 提问、会话群管理
- `src/config.ts`：环境变量与配置校验
- `src/feishu/`：飞书 SDK 封装与卡片构建
  - `client.ts`：飞书客户端封装（消息收发、卡片、附件）
  - `cards.ts`：消息卡片模板（权限、问题、流式输出、控制面板）
  - `attachment.ts`：附件处理（Data URL 转换）
- `src/opencode/`：OpenCode SDK 封装与输出缓冲
  - `client.ts`：OpenCode 客户端封装（连接、事件订阅、会话管理、消息发送）
  - `output-buffer.ts`：智能输出缓冲（防止频繁消息轰炸）
  - `delayed-handler.ts`：延迟响应处理器（等待和提醒机制）
  - `question-handler.ts`：AI 提问处理器（问题注册、过期清理）
- `src/commands/`：命令解析
  - `parser.ts`：命令解析器（17 种命令类型）
- `src/permissions/`：权限处理
  - `handler.ts`：工具白名单与权限处理
- `src/store/`：会话存储
  - `user-session.ts`：用户会话持久化存储
  - `session-group.ts`：会话群映射（私聊→群）
  - `session-directory.ts`：会话目录映射（每个会话独立工作目录）

## 代码风格与约定

### 模块与导入

- 使用 ESM 语法（`import ... from ...`）
- NodeNext 要求本地导入带 `.js` 扩展名（示例：`./config.js`）
- 外部依赖先于本地模块导入
- 类型导入使用 `import type`

### 格式化

- 2 空格缩进
- 语句末尾使用分号
- 行宽保持可读性优先，避免超长链式调用

### 命名

- 变量/参数：`camelCase`
- 类型/接口/类：`PascalCase`
- 函数名用动词开头（例如 `handleMessage`、`getModelOptions`）
- 文件名使用小写与连字符（例如 `output-buffer.ts`）

### 类型系统

- TypeScript `strict: true`，必须通过类型检查
- 避免 `any`，用明确类型或窄化
- 公开函数标注返回类型（如 `Promise<void>`）
- 对第三方返回值做类型守卫（`Array.isArray`、`typeof`）

### 错误处理

- 调用外部 API 必须 `try/catch`
- 失败时记录可诊断日志并返回 `null/false`
- 将未知错误转换为字符串或结构化信息再输出

### 日志

- 使用 `console.log` / `console.error`
- 日志前缀使用方括号区分模块（如 `[飞书]`、`[OpenCode]`、`[权限]`、`[问题]`、`[延迟响应]`、`[会话群]`、`[SSE]`）
- 输出内容避免泄露敏感配置

### 异步与资源

- 异步函数使用 `async/await`，避免悬挂的 Promise
- 对外部请求允许设置超时（已有 `Promise.race` 示例）
- 退出时执行清理（连接断开等）

### 配置与环境变量

- `dotenv/config` 在 `src/config.ts` 统一加载
- 所有环境变量读取集中在 `src/config.ts`
- `validateConfig()` 启动时校验必需变量
- 支持的配置项：
  - `FEISHU_APP_ID`、`FEISHU_APP_SECRET`：飞书应用凭证
  - `ALLOWED_USERS`：用户白名单（支持多个用户，逗号分隔）
  - `DEFAULT_PROVIDER`、`DEFAULT_MODEL`：默认模型配置
  - `TOOL_WHITELIST`：工具白名单（自动允许，无需确认）
  - `OUTPUT_UPDATE_INTERVAL`：输出更新间隔（毫秒，默认 3000）
  - `MAX_DELAYED_RESPONSE_WAIT_MS`：延迟响应最大等待时间（毫秒，默认 120000）
  - `ATTACHMENT_MAX_SIZE`：附件最大大小（字节）

### 消息与文本

- 飞书文本消息使用 JSON `{ text }` 形式
- 业务输出以中文为主（项目当前消息均为中文）
- 输出长度受限（见 `outputConfig.maxMessageLength`）

### 会话与状态

#### 会话模式

支持三种会话模式：
- **Thread 模式**: 群内会话（`thread:{threadId}`）
- **User 模式**: 私聊会话（`user:{userId}`）
- **Chat 模式**: 会话群模式（`chat:{chatId}`）

#### 私聊会话群机制

私聊模式下会自动创建会话群，消息转入群内处理：
1. 用户私聊发消息
2. 系统创建或复用会话群
3. 消息自动转入群内
4. 后续操作在群内进行

#### 会话状态管理

- 会话状态在内存中维护（`conversationStates` Map）
- 每个会话包含：`lastOpencodeMessageId`、`lastFeishuReplyMessageId`、`lastUserMessageId`、`agent`、`chatId`
- 会话持久化通过 `userSessionStore`（JSON 文件存储）
- 会话群映射通过 `sessionGroupStore`（用户→会话群）
- 会话目录映射通过 `sessionDirectoryStore`（会话→工作目录）

#### 会话清理机制

触发会话清理的事件：
- `im.chat.member.user.deleted_v1`：用户离开群（创建者离开时）
- `im.chat.disbanded_v1`：群解散
- `im.chat.member.bot.deleted_v1`：机器人被移除

清理步骤：
1. 取消所有 pending 响应
2. 清理所有待回答问题
3. 中断并删除 OpenCode 会话
4. 清理会话目录映射
5. 清理所有相关缓存（`conversationStates`、`promptIndex`、`messageMappings`、`assistantToPrompt`）
6. 清理用户会话映射
7. 删除会话群映射
8. 可选：删除飞书群

### 卡片交互

- 卡片动作通过 `card.action.trigger` 事件处理（在 `src/feishu/client.ts` 中监听）
- 卡片 `action.value` 必须包含 `action` 字段
- 选择类卡片需处理多种回调结构（`option.value` / `value.selected`）
- 卡片更新使用 `updateCard` 方法，失败时降级为 `sendCard` + `replyCard`

#### 支持的卡片类型

1. **权限确认卡片** (`buildPermissionCard`)
   - 显示工具名称、操作描述、风险等级
   - 允许/拒绝按钮
   - "永久允许"选项

2. **问题卡片** (`buildQuestionCardV2`)
   - 只读展示 + 文本回复方式
   - 支持选项分页（每页 10 个选项）
   - 跳过按钮

3. **流式输出卡片** (`buildStreamCard`)
   - 显示思考过程（灰色引用块）
   - 显示工具状态（等待/执行中/完成/失败）
   - 显示输出内容
   - 支持展开/收起思考

4. **控制面板卡片** (`buildControlCard`)
   - 显示当前模型
   - 显示当前 Agent
   - 提供模型切换按钮
   - 提供 Agent 切换按钮
   - 提供会话切换/列表/清空按钮
   - 提供中断按钮

### 延迟响应处理

OpenCode 可能会延迟返回响应（如需要额外处理），系统通过 `delayed-handler.ts` 处理：

- **等待机制**：延迟响应自动注册并等待
- **提醒机制**：每 5 分钟检查一次等待状态
- **自动处理**：收到延迟响应后自动发送给用户
- **过期清理**：定期清理超时的等待（默认 2 分钟）

### AI 提问处理

当 AI 需要用户输入时（如选择文件、确认操作等），系统发送问题卡片：

- **问题注册**：通过 `questionHandler.register` 注册问题
- **卡片发送**：使用 `buildQuestionCardV2` 发送只读卡片
- **答案提交**：用户直接回复文本或卡片提交按钮
- **过期清理**：每 2 分钟清理超时的未回答问题

### 附件处理

- 支持格式：`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.pdf`、`.pjp` 等
- 处理方式：转为 Data URL 格式
- 传输方式：直接通过飞书消息发送
- 大小限制：受 `ATTACHMENT_MAX_SIZE` 配置控制
- 无需本地文件服务

### 输出缓冲机制

为了防止飞书 API 限流，实现智能输出缓冲（`output-buffer.ts`）：

- **缓冲策略**：输出先存入缓冲区
- **定时合并**：定期合并更新（默认 3 秒一次）
- **避免重复**：相同消息避免重复发送

### 命令系统

#### 命令类型

| 类型 | 功能 | 说明 |
|------|------|------|
| `prompt` | 普通消息，发送给 AI 执行 |
| `stop` | 中断当前执行 |
| `undo` | 撤回上一步（OpenCode + 飞书） |
| `abort` | 取消当前操作 |
| `model <名称>` | 切换模型（如 `/model claude-4`） |
| `model` | 查看当前模型 |
| `model list` | 列出可用模型 |
| `agent <名称>` | 切换 Agent（如 `/agent default`） |
| `agent` | 查看当前 Agent |
| `session new` | 创建新对话 |
| `session <id>` | 切换到指定对话 |
| `sessions` | 列出所有对话 |
| `clear` | 清空当前对话 |
| `panel` | 打开控制面板 |
| `status` | 查看当前状态 |
| `command` | 透传命令到 OpenCode |
| `permission` | 权限响应（`y`/`n`） |

#### 命令示例

```
# 切换模型
/model claude-4

# 查看当前模型
/model

# 创建新对话
/session new

# 切换到指定对话
/session abc123

# 列出所有对话
/sessions
```

### 权限管理

- **白名单机制**：`TOOL_WHITELIST` 配置的工具自动允许，无需确认
- **卡片确认**：其他工具发送权限确认卡片
- **文本确认**：用户回复 `y` 或 `n`
- **会话隔离**：权限请求与会话绑定，不同会话独立管理

## 代码变更原则

- 先读相关文件再修改
- 尽量复用已有模块与函数
- 修改范围最小化，避免无关格式化
- 新增注释仅用于解释非显而易见逻辑

## 文档更新

- 新增/变更脚本、配置或规则时同步更新 `AGENTS.md`
- 新增/变更功能时同步更新 `README.md`
