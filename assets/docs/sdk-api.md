# OpenCode SDK API 参考文档

## 一、SDK 概述

OpenCode SDK 版本: `1.1.59` (latest)，包名: `@opencode-ai/sdk`

入口: `createOpencodeClient(config?)` 返回 `OpencodeClient` 实例，config 支持 `{ baseUrl, directory? }`。

## 二、`OpencodeClient` 完整 API 列表

```
OpencodeClient
├── postSessionIdPermissionsPermissionId()  // 响应权限请求
├── global: Global
│   └── .event()                            // 获取全局事件流 (SSE)
├── project: Project
│   ├── .list()                             // 列出所有项目
│   └── .current()                          // 获取当前项目
├── pty: Pty
│   ├── .list()                             // 列出所有 PTY 会话
│   ├── .create()                           // 创建新 PTY 会话
│   ├── .remove({ path: { id } })           // 移除 PTY 会话
│   ├── .get({ path: { id } })              // 获取 PTY 会话信息
│   ├── .update({ path: { id } })           // 更新 PTY 会话
│   └── .connect({ path: { id } })          // 连接到 PTY 会话
├── config: Config
│   ├── .get()                              // 获取配置
│   ├── .update({ body })                   // 更新配置
│   └── .providers()                        // 列出所有提供商
├── tool: Tool
│   ├── .ids()                              // 列出所有工具 ID
│   └── .list({ query: { providerID, modelID } }) // 列出工具详情（含参数 schema）
├── instance: Instance
│   └── .dispose()                          // 销毁当前实例
├── path: Path
│   └── .get()                              // 获取当前路径
├── vcs: Vcs
│   └── .get()                              // 获取 VCS（Git）信息
├── session: Session
│   ├── .list()                             // 列出所有会话
│   ├── .create({ body: { title, parentID }, query: { directory } })
│   ├── .status()                           // 获取会话状态
│   ├── .delete({ path: { id } })           // 删除会话
│   ├── .get({ path: { id } })              // 获取会话详情
│   ├── .update({ path: { id } })           // 更新会话属性
│   ├── .children({ path: { id } })         // 获取子会话
│   ├── .todo({ path: { id } })             // 获取 Todo 列表
│   ├── .init({ path: { id } })             // 分析应用并创建 AGENTS.md
│   ├── .fork({ path: { id } })             // 在特定消息处分叉会话
│   ├── .abort({ path: { id } })            // 中断会话
│   ├── .unshare({ path: { id } })          // 取消共享会话
│   ├── .share({ path: { id } })            // 共享会话
│   ├── .diff({ path: { id } })             // 获取会话 diff
│   ├── .summarize({ path: { id } })        // 总结会话
│   ├── .messages({ path: { id } })         // 列出会话消息
│   ├── .prompt({ path: { id }, body })     // 发送消息（同步）
│   ├── .message({ path: { id, messageId } }) // 获取特定消息
│   ├── .promptAsync({ path: { id }, body }) // 异步发送消息
│   ├── .command({ path: { id }, body })    // 发送命令
│   ├── .shell({ path: { id } })            // 运行 Shell 命令
│   ├── .revert({ path: { id } })           // 撤回消息
│   └── .unrevert({ path: { id } })         // 恢复所有已撤回的消息
├── command: Command
│   └── .list()                             // 列出所有命令
├── provider: Provider
│   ├── .list()                             // 列出所有提供商
│   ├── .auth()                             // 获取提供商认证方式
│   └── .oauth: Oauth
│       ├── .authorize({ path: { provider } })  // OAuth 授权
│       └── .callback({ path: { provider } })   // OAuth 回调
├── find: Find
│   ├── .text({ query })                    // 文本搜索
│   ├── .files({ query })                   // 文件搜索
│   └── .symbols({ query })                 // 工作区符号搜索
├── file: File
│   ├── .list({ query: { path } })          // 列出文件和目录
│   ├── .read({ query: { path } })          // 读取文件内容
│   └── .status()                           // 获取文件状态
├── app: App
│   ├── .log({ body })                      // 写日志
│   └── .agents()                           // 列出所有 Agent
├── mcp: Mcp
│   ├── .status()                           // 获取 MCP 服务器状态
│   ├── .add({ body })                      // 动态添加 MCP 服务器
│   ├── .connect({ path: { id } })          // 连接 MCP 服务器
│   ├── .disconnect({ path: { id } })       // 断开 MCP 服务器
│   └── .auth: Auth
│       ├── .remove({ path: { id } })       // 移除 MCP OAuth 凭证
│       ├── .start({ path: { id } })        // 开始 MCP OAuth 流程
│       ├── .callback({ path: { id } })     // 完成 MCP OAuth
│       └── .authenticate({ path: { id } }) // 开启浏览器完成 OAuth
├── lsp: Lsp
│   └── .status()                           // 获取 LSP 服务器状态
├── formatter: Formatter
│   └── .status()                           // 获取格式化器状态
├── tui: Tui
│   ├── .appendPrompt({ body })             // 追加提示
│   ├── .openHelp()                         // 打开帮助对话框
│   ├── .openSessions()                     // 打开会话对话框
│   ├── .openThemes()                       // 打开主题对话框
│   ├── .openModels()                       // 打开模型对话框
│   ├── .submitPrompt()                     // 提交提示
│   ├── .clearPrompt()                      // 清除提示
│   ├── .executeCommand({ body })           // 执行 TUI 命令
│   ├── .showToast({ body })                // 显示 Toast 通知
│   ├── .publish({ body })                  // 发布 TUI 事件
│   └── .control: Control
│       ├── .next()                         // 获取下一个 TUI 请求
│       └── .response({ body })             // 提交 TUI 请求响应
├── auth: Auth
│   └── .set({ body })                      // 设置认证凭证
└── event: Event
    └── .subscribe()                        // 订阅事件流 (SSE)
```

## 三、Project 相关 API

### `Project` 类型定义

```typescript
export type Project = {
    id: string;
    worktree: string;
    vcsDir?: string;
    vcs?: "git";
    time: {
        created: number;
        initialized?: number;
    };
};
```

字段说明：
- `id` - 项目唯一 ID
- `worktree` - 工作目录路径
- `vcsDir` - 版本控制目录（可选）
- `vcs` - 版本控制类型，目前仅支持 `"git"`（可选）
- `time.created` - 创建时间戳
- `time.initialized` - 初始化时间戳（可选）

### `project.list()` 方法

**方法签名**:
```typescript
list<ThrowOnError extends boolean = false>(
    options?: Options<ProjectListData, ThrowOnError>
): RequestResult<ProjectListResponses, unknown, ThrowOnError, "fields">;
```

**参数**:
```typescript
export type ProjectListData = {
    body?: never;
    path?: never;
    query?: {
        directory?: string;    // 可选的 directory 参数
    };
    url: "/project";
};
```

**返回类型**:
```typescript
export type ProjectListResponses = {
    200: Array<Project>;
};
```

### `project.current()` 方法

**方法签名**:
```typescript
current<ThrowOnError extends boolean = false>(
    options?: Options<ProjectCurrentData, ThrowOnError>
): RequestResult<ProjectCurrentResponses, unknown, ThrowOnError, "fields">;
```

**参数**:
```typescript
export type ProjectCurrentData = {
    body?: never;
    path?: never;
    query?: {
        directory?: string;    // 可选的 directory 参数
    };
    url: "/project/current";
};
```

**返回类型**:
```typescript
export type ProjectCurrentResponses = {
    200: Project;
};
```

## 四、Session 相关 API

### `Session` 类型定义

```typescript
export type Session = {
    id: string;
    projectID: string;
    directory: string;
    parentID?: string;
    summary?: {
        additions: number;
        deletions: number;
        files: number;
        diffs?: Array<FileDiff>;
    };
    share?: {
        url: string;
    };
    title: string;
    version: string;
    time: {
        created: number;
        updated: number;
        compacting?: number;
    };
    revert?: {
        messageID: string;
        partID?: string;
        snapshot?: string;
        diff?: string;
    };
};
```

### `session.create()` 方法

**方法签名**:
```typescript
create<ThrowOnError extends boolean = false>(
    options?: Options<SessionCreateData, ThrowOnError>
): RequestResult<SessionCreateResponses, SessionCreateErrors, ThrowOnError, "fields">;
```

**参数**:
```typescript
export type SessionCreateData = {
    body?: {
        parentID?: string;     // 父会话 ID（可选，用于创建子会话）
        title?: string;        // 会话标题（可选）
    };
    path?: never;
    query?: {
        directory?: string;    // ★ directory 参数在 query 中，可选
    };
    url: "/session";
};
```

**返回类型**:
```typescript
export type SessionCreateResponses = {
    200: Session;              // 返回创建的 Session 对象
};
```

### `session.list()` 方法

**方法签名**:
```typescript
list<ThrowOnError extends boolean = false>(
    options?: Options<SessionListData, ThrowOnError>
): RequestResult<SessionListResponses, unknown, ThrowOnError, "fields">;
```

**参数**:
```typescript
export type SessionListData = {
    body?: never;
    path?: never;
    query?: {
        directory?: string;    // ★ directory 参数在 query 中，可选
    };
    url: "/session";
};
```

**返回类型**:
```typescript
export type SessionListResponses = {
    200: Array<Session>;       // 返回 Session 数组
};
```

## 五、关键发现

1. **SDK 没有 `workspace` 命名空间**，但有 `project` 命名空间（`project.list()` / `project.current()`）可获取工作区信息
2. **`session.create()` 和 `session.list()` 均支持 `query: { directory? }` 参数**，可以按目录创建/过滤会话
3. **`project.create()` 方法不存在**——工作区的创建是 OpenCode 侧管理的
4. **所有 API 方法的 `directory` 参数**：统一通过 `options.query.directory` 传递，且均为可选
5. **`Session` 类型包含 `directory` 字段**：每个会话关联一个目录

## 六、与桥接代码的集成

当前桥接代码中：
- **`session.create()` 的 `directory` 参数未被使用**：所有会话都在默认目录下
- **`project.list()`/`project.current()` 未被使用**：工作区管理功能未实现
- **权限响应**：`client.postSessionIdPermissionsPermissionId()` 是 SDK 提供的方法，但桥接代码中通过原始 fetch 实现
- **异步发消息**：`session.promptAsync()` 已作为 SDK 方法存在，但桥接代码中仍然使用原始 fetch 调用 `/session/{id}/prompt_async` 端点

## 七、建议的集成方式

1. **列出工作区**：调用 `client.project.list()` 获取所有项目
2. **切换工作区**：调用 `client.project.current()` 获取当前项目，或 `client.session.create({ query: { directory } })` 创建新会话
3. **创建新工作区**：在文件系统创建文件夹，然后调用 `client.session.create({ query: { directory } })` 触发 OpenCode 注册（需验证是否有效）