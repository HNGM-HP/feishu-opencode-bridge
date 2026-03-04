## 2026-03-04 Task: 会话键命名空间策略与兼容迁移

### 已知问题
- 旧版 `.chat-sessions.json` 中的 `chatId` 键不会自动迁移（需依赖首次读取触发）
- 多平台并发场景下，同 `chatId` 但不同平台的会话需通过 `platform` 区分

### 修复线索
- 命名空间键生成逻辑：`makeConversationKey('feishu', chatId) -> 'feishu:chatId'`
- 旧键回退逻辑：`legacyToNamespacedKey(chatId)` 预留扩展点（未来可支持多平台）

## 2026-03-04T00:00:00Z Task: init

### 初始化记录：用于沉淀已知问题、坑点与修复线索。

## 2026-03-04 Task: T3 verification note (orchestrator)

### 已确认偏差
- `src/router/root-router.ts` 仍包含较多业务逻辑（权限/卡片动作/问题跳过），未达到“仅编排骨架”目标。
- `src/index.ts` 已改为通过 `rootRouter` 分发 message/cardAction，行为可编译通过。

### 后续处理建议
- 在后续任务（优先 T7/T9）继续收敛 `root-router` 职责，逐步下沉业务逻辑回 index handler 或专用模块。

## 2026-03-04 Task: 创建 Root Router 骨架

### 待后续任务处理
- OpenCode 事件（permissionRequest, messagePartUpdated 等）仍在 index.ts 中处理
- Timeline 相关闭包（upsertTimelineNote 依赖 streamTimelineMap）未完全解耦
- 卡片动作处理中的部分逻辑（如 timeline 更新）需通过回调注入

### 迁移风险
- 当前为 pass-through 模式，路由器内逻辑与 index.ts 原逻辑完全一致
- 如需修改权限/问题处理逻辑，需同时考虑 router 和 index.ts 的同步
- 回调注入模式增加了调用链深度，调试时需注意

## 2026-03-04 Task: T3 Root Router 纯编排骨架重构

### 已解决
- 移除了 root-router.ts 中的业务逻辑（权限处理、问题跳过、文本权限解析）
- 移除了对 opencodeClient、permissionHandler、outputBuffer、feishuClient 的直接依赖
- TimelineCallbacks 接口已移除（改由 action-handlers 注入 upsertTimelineNote）

### 后续任务可优化
- action-handlers.ts 仍直接依赖多个模块，未来可进一步解耦
- index.ts 中的 tryHandlePendingPermissionByText 和 parsePermissionDecision 已被 action-handlers 取代，可考虑清理
\n## 2026-03-04 Task: T9 OpenCode 事件分发器抽取\n\n### 已解决\n- 将 7 个 OpenCode 事件监听器从 index.ts 迁移到 `src/router/opencode-event-hub.ts`\n- 通过上下文注入模式解耦，避免 hub 直接导入所有依赖\n- 保持单监听器架构，每种事件仅注册一次\n\n### 类型设计\n- `OpenCodeEventContext` 接口封装所有依赖的状态和辅助函数\n- `StreamCardData` 类型从 cards-stream 导入，避免循环依赖\n- 动态 require 获取模块级单例（chatSessionStore, permissionHandler 等）\n\n### 后续优化建议\n- `applyFailureToSession` 函数仍定义在上下文注入之前，可考虑移到 hub 内部或独立模块\n- 上下文注入点在所有辅助函数声明之后，需要确保顺序正确

## 2026-03-04 Task: T10 抽象输出发送接口

### 已解决
- `outputBuffer.setUpdateCallback` 不再直接调用 `feishuClient` API
- 改为通过 `PlatformSender` 接口发送，便于未来支持多平台

### 后续优化建议
- 考虑将 sender 提升到更高层级（如注入到 outputBuffer 构造时）
- 可进一步将 `applyFailureToSession` 中的 `feishuClient.sendText` 也改为使用 sender

- 考虑将 `applyFailureToSession` 中的 `feishuClient.sendText` 也改为使用 sender

## 2026-03-04 Task: T11 建立飞书回归守护测试脚手架（tests-after）

### 测试框架选择
- Vitest (v4.0.18): 更快的执行速度，原生的 ESM 支持，与 Vite 生态一致
- 配置文件: `vitest.config.ts`，使用 `type: 'module'` 匹配项目配置

### 测试覆盖要点
- **chat-session**: 命名空间兼容性、别名机制、会话类型判断
- **router-config**: 配置解析、fallback 行为、平台启用判断
- **directory-policy**: 路径规范化、安全检查、允许列表校验

### 已知测试限制
- `routerConfig` 在模块加载时计算，动态修改环境变量不会影响其值（测试中已调整策略，验证实际运行时行为）
- `DirectoryPolicy.resolve` 中的文件系统访问使用实际文件系统，测试需确保路径存在

### 平台差异处理
- Windows 路径使用反斜杠，Linux 使用正斜杠
- 危险路径列表在不同平台上有不同定义
- 大小写敏感性: Windows 不敏感，Linux 敏感

### 后续测试扩展建议
- 添加集成测试验证多平台场景
- 添加性能测试验证大量会话的读写性能
- 考虑添加 Mock 文件系统以提高测试独立性


## 2026-03-04 Task: T12 Discord 适配器脚手架

### 当前限制
- Discord 适配器仅为脚手架，暂无真实的 ingress-egress 实现
- `start()` 和 `stop()` 方法为空实现
- 未实现 `onMessage`、`onAction` 等事件监听器
- `getSender()` 返回 null（暂无 DiscordSender 实现）

### 下一任务依赖
- **T13 路由与会话绑定**: 需要实现真实的 Discord 路由逻辑和会话绑定
- **DiscordSender**: 需要实现 `PlatformSender` 接口的 Discord 发送器
- **DiscordClient**: 需要集成 Discord.js 或类似库实现真实的客户端连接


## 2026-03-04 Task: F2 Code Quality Review

### 发现问题
- **medium**: src/feishu/client.ts:349 - @ts-ignore 用于群解散事件监听（第三方库边界）
- **medium**: src/feishu/client.ts:360 - @ts-ignore 用于消息撤回事件监听（第三方库边界）
- **N/A**: 项目无 ESLint 配置，建议后续添加

### 质量评估
- Build: PASS (TypeScript 编译成功)
- Tests: PASS (53/53 通过)
- LSP Diagnostics: PASS (核心文件无警告)
- Files: 2 issues (非阻塞性，第三方库兼容场景)

### 建议修复
1. 为飞书 SDK 事件类型添加 `.d.ts` 类型扩展文件，消除 @ts-ignore
2. 添加 ESLint 配置文件，统一代码风格检查

### VERDICT
✅ PASS - 代码质量良好，可发布
核心改造文件 (root-router, opencode-event-hub, chat-session) 质量达标
