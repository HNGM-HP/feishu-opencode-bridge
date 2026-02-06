# AGENTS.md

面向自动化编码代理的工作指南。

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

### Lint

- 未配置 lint 命令（`package.json` 无相关脚本）

### Test

- 未配置测试框架与测试脚本
- 单测运行：无（当前仓库不存在单测命令）

## 项目结构速览

- `src/index.ts`：入口与消息/卡片处理
- `src/config.ts`：环境变量与配置校验
- `src/feishu/`：飞书 SDK 封装与卡片构建
- `src/opencode/`：OpenCode SDK 封装与输出缓冲
- `src/commands/`：命令解析
- `src/permissions/`：权限处理
- `src/store/`：会话存储

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
- 日志前缀使用方括号区分模块（如 `[飞书]`、`[OpenCode]`）
- 输出内容避免泄露敏感配置

### 异步与资源

- 异步函数使用 `async/await`，避免悬挂的 Promise
- 对外部请求允许设置超时（已有 `Promise.race` 示例）
- 退出时执行清理（连接断开等）

### 配置与环境变量

- `dotenv/config` 在 `src/config.ts` 统一加载
- 所有环境变量读取集中在 `src/config.ts`
- `validateConfig()` 启动时校验必需变量

### 消息与文本

- 飞书文本消息使用 JSON `{ text }` 形式
- 业务输出以中文为主（项目当前消息均为中文）
- 输出长度受限（见 `outputConfig.maxMessageLength`）

### 会话与状态

- 会话状态在内存中维护（`conversationStates`）
- 会话持久存储通过 `userSessionStore`
- 同一会话键使用统一格式：`thread:` / `user:` / `chat:`

### 卡片交互

- 卡片动作通过 `card.action.trigger` 事件处理
- 卡片 `action.value` 必须包含 `action` 字段
- 选择类卡片需处理多种回调结构（`option.value` / `value.selected`）

## 代码变更原则

- 先读相关文件再修改
- 尽量复用已有模块与函数
- 修改范围最小化，避免无关格式化
- 新增注释仅用于解释非显而易见逻辑

## 文档更新

- 新增/变更脚本、配置或规则时同步更新 `AGENTS.md`
