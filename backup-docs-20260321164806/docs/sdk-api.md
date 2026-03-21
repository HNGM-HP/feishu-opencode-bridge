# OpenCode SDK 集成说明（桥接侧，v2.9.3-beta）

本文档不是官方 SDK 全量手册，而是本项目在 `src/opencode/client.ts` 中的实际封装与调用约定。

## 1. 集成原则

- 以桥接稳定性为优先：统一错误处理、统一日志、统一重试策略。
- 会话、消息、权限、问题都通过 `OpencodeClientWrapper` 暴露，不在业务层直接调底层 SDK。
- 平台层只关心业务结果，不关心 SDK 细节。

## 2. 关键类型

### 2.1 权限事件

```ts
interface PermissionRequestEvent {
  sessionId: string;
  permissionId: string;
  tool: string;
  description: string;
  risk?: string;
  parentSessionId?: string;
  relatedSessionId?: string;
  messageId?: string;
  callId?: string;
}
```

### 2.2 权限回传选项

```ts
interface PermissionResponseOptions {
  directory?: string;
  fallbackDirectories?: string[];
}
```

用途：目录切换后权限回传优先命中当前目录实例，失败再按候选目录回退。

## 3. 封装方法总览

### 3.1 连接与事件

- `connect()`：初始化 SDK 客户端并验证可用性。
- `disconnect()`：关闭事件流与重连定时器。
- `startEventListener()`：启动全局事件订阅。
- `_createDirectoryEventStream()`：目录级事件流（按需建立）。

### 3.2 会话与项目

- `listProjects(directory?)`
- `listSessions(directory?)`
- `listSessionsAcrossProjects()`
- `findSessionAcrossProjects(sessionId)`
- `createSession(title?, directory?)`
- `updateSession(sessionId, title)`
- `deleteSession(sessionId, directory?)`
- `getSessionById(sessionId)`
- `getSessionMessages(sessionId)`

### 3.3 消息与命令

- `sendMessage(sessionId, text, options)`
- `sendMessageAsync(sessionId, text, options)`
- `sendMessageParts(sessionId, parts, options)`
- `sendMessagePartsAsync(sessionId, parts, options)`
- `sendCommand(sessionId, command, args?)`
- `sendShellCommand(sessionId, command, options)`

### 3.4 权限与问题

- `respondToPermission(sessionId, permissionId, allow, remember?, options?)`
- `replyQuestion(sessionId, questionId, answers)`
- `rejectQuestion(sessionId, questionId)`

### 3.5 会话控制

- `abortSession(sessionId)`
- `revertMessage(sessionId, messageId)`
- `summarizeSession(sessionId, providerId, modelId)`

### 3.6 配置与元数据

- `getProviders()`
- `getConfig()`
- `updateConfig(body)`
- `getAgents()`

## 4. 权限回传目录策略（重点）

`respondToPermission(...)` 当前实现具备以下行为：

1. 允许传入 `directory` 和 `fallbackDirectories`。
2. 逐个目录候选尝试请求：
   - 命中即返回成功；
   - 失败记录日志并继续尝试下一个候选；
3. 最后回退到默认目录实例（无 `directory` query）。

这能显著降低“切换工作目录后权限允许日志已打印，但任务仍卡住”的问题。

## 5. 事件分发约定

桥接侧通过 `OpenCodeEventHub` 消费 SDK 事件，关键事件包括：

- `permissionRequest`
- `questionAsked`
- `messagePartUpdated`
- `messageUpdated`
- `sessionStatus`
- `sessionIdle`
- `sessionError`

推荐做法：

- 在事件层只做路由与状态变更，不做平台 UI 拼装。
- UI 相关由 Feishu/Discord 渲染层各自处理。

## 6. 常见调用模板

### 6.1 发送消息（带目录与模型）

```ts
await opencodeClient.sendMessage(sessionId, prompt, {
  providerId,
  modelId,
  directory,
  agent,
  variant,
});
```

### 6.2 响应权限（目录感知）

```ts
await opencodeClient.respondToPermission(sessionId, permissionId, true, false, {
  directory: resolvedDirectory,
  fallbackDirectories: knownDirectories,
});
```

### 6.3 回复问题

```ts
await opencodeClient.replyQuestion(sessionId, requestId, answers);
```

## 7. 排障清单

- 401/403：先核对 `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`。
- 会话找不到：检查 `sessionId` 是否跨目录，尝试 `findSessionAcrossProjects`。
- 权限卡住：检查权限回传是否带目录候选。
- 流式无输出：检查事件监听是否已启动、OutputBuffer 是否触发更新。

## 8. 升级建议

- 升级 SDK 前先跑全量测试并观察 `PermissionRequestEvent` 字段兼容性。
- 保持桥接封装层稳定，避免业务层直接耦合 SDK 原始字段。
- 任何权限/目录相关改动都需要补回归测试。
