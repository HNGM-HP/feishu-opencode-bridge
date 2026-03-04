## 2026-03-04 Task: T15 双轨对比日志与回滚开关完善

### 实现要点
- 双轨模式日志改为结构化 JSON 格式，包含 `platform`、`conversationKey`、`sessionId`、`routeDecision` 等关键信息
- 启动日志添加明确的回滚指令："如需回滚到旧版路由，设置 ROUTER_MODE=legacy 并重启服务"
- RootRouter 新增 `chatSessionStore` 导入，用于获取 sessionId
- FeishuCardActionEvent.chatId 为可选字段，需做 null 检查

### 结构化日志字段
- `type`: '[Router][dual]'
- `event`: 'onMessage' | 'onAction' | 'onOpenCodeEvent'
- `platform`: 'feishu' | 'opencode' | 'discord'
- `conversationKey`: '{platform}:{chatId}' | 'internal' | 'unknown'
- `sessionId`: 从 chatSessionStore 获取，无会话时为 'none'
- `routeDecision`: 'p2p' | 'group' | 'card_action' | 'opencode_event'
- 其他字段：`chatType`, `chatId`, `messageId`, `eventType`（根据事件类型）

### 代码变更
- `src/router/root-router.ts`:
  - 新增 `import { chatSessionStore } from '../store/chat-session.js'`
  - `onMessage` 日志改为 JSON 结构，包含 sessionId、conversationKey、routeDecision
  - `onAction` 日志改为 JSON 结构，处理 chatId 可选情况
  - `onOpenCodeEvent` 日志改为 JSON 结构
- `src/index.ts`:
  - 启动日志添加回滚指令提示

### 验证结果
- **build pass**: `npm run build` 通过，无类型错误
- **vitest pass**: `npx vitest run` 全部通过（53 tests）
- **runtime**: 双轨模式日志输出为 JSON 格式，便于解析和审计

### 安全注意事项
- 日志不包含敏感内容（无完整消息文本）
- sessionId 可能为 null，使用 `?? 'none'` 提供默认值
- FeishuCardActionEvent.chatId 为可选字段，需要条件判断


## 2026-03-04T06:09 收尾复核

### 复核结论
**无需修改**：当前代码结构正确，不存在重复输出问题。

### 分析结果
1. **启动日志**（`src/index.ts` 第 46-55 行）：
   - 只在 `main()` 函数启动时执行**一次**
   - 输出 `[Config] 路由器模式`、`[Config] 双轨模式`、`[Config] 回滚指引`
   - 逻辑正确，无重复

2. **事件日志**（`src/router/root-router.ts` 第 110-124、148-161、181-192 行）：
   - 在 `onMessage`、`onAction`、`onOpenCodeEvent` 中输出
   - 每次事件触发时执行（非启动时）
   - 结构化 JSON 格式，包含 `type`、`event`、`platform`、`conversationKey`、`sessionId`、`routeDecision`
   - 逻辑正确，无重复

### 搜索确认
- 全项目搜索 `ROUTER_MODE`、`双轨模式`、`回滚.*legacy`，确认只有 `index.ts` 和 `config.ts` 使用
- `root-router.ts` 仅引用 `routerConfig.mode`，不输出启动日志
- 无其他模块输出重复的配置日志

### 验证结果
- **build**: ✅ `npm run build` 通过
- **vitest**: ✅ `npx vitest run` 53 tests 全部通过

### 最终状态
- dual 模式启动时只输出一组路由对比提示（无重复）
- 保留结构化字段 `platform/conversationKey/sessionId/routeDecision`
- 保留 legacy 一键回滚指引文案（不泄露敏感信息）
- 行为兼容：`legacy` 仍是默认安全模式，`dual` 仅观测不改行为