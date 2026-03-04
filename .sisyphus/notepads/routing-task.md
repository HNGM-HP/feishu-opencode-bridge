# Routing Task Learnings

## Findings

### Current State

1. **飞书消息入口** (`src/index.ts` lines 1021-1024)
   - `feishuClient.on('message')` 已正确路由到 `rootRouter.onMessage(event)`

2. **卡片动作入口** (`src/index.ts` lines 1031-1034)
   - `feishuClient.setCardActionHandler()` 已正确路由到 `rootRouter.onAction(event)`

3. **Router 分发逻辑** (`src/router/root-router.ts`)
   - `onMessage()`: 根据 `chatType` 路由到 `p2pHandler` 或 `groupHandler`
   - `groupHandler` 处理中包含 `tryHandlePendingPermissionByText()` 逻辑
   - `onAction()`: 根据 `action.value.action` 路由到不同处理器

### 统一入口确认

| 入口 | 目标方法 | 是否通过 Router |
|-----|---------|----------------|
| `feishuClient.on('message')` | `rootRouter.onMessage()` | ✅ |
| `feishuClient.setCardActionHandler()` | `rootRouter.onAction()` | ✅ |

### 分支逻辑验证

1. **Permission Text Handling** (group handler path)
   - `groupHandler.handleMessage()` 中调用 `checkPendingQuestion()` 处理问题跳过
   - `rootRouter` 中的 `tryHandlePendingPermissionByText()` 处理文本权限响应
   - ✅ 行为保持一致

2. **Card Action Branches**
   - `create_chat*` → `p2pHandler.handleCardAction()`
   - `permission_allow/deny` → `router.handlePermissionAction()`
   - `question_skip` → `router.handleQuestionSkipAction()`
   - 其他 → `cardActionHandler.handle()`
   - ✅ 分支逻辑完整

### 定义: OpenCode Listener

OpenCode 事件监听 (lines 1037-1460) 由 index.ts 内部处理，不经过飞书路由，这是预期设计。

## Issues Encountered

None - existing routing is correct.

## Architectural Decisions

1. **Router 职责**: 仅编排，不包含业务逻辑（符合设计原则）
2. **权限文本响应**: 在 `rootRouter` 中统一处理，避免在 `groupHandler` 中重复逻辑
3. **OpenCode Events**: 独立处理路径，不通过飞书路由器

## Unresolved Questions

None - all routing is properly implemented.
