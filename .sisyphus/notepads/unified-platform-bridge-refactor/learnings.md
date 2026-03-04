## 2026-03-04T00:00:00Z Task: init
初始化记录：用于沉淀约定、模式与可复用经验。

## 2026-03-04 Task: 建立平台注册中心与能力查询

### 实现要点
- 平台注册中心使用 `Map<string, PlatformAdapter>` 存储适配器
- 平台启用状态优先级：环境变量 > 适配器属性 > 默认策略
- 默认策略：feishu 默认启用，其他默认禁用（确保向后兼容）
- 环境变量格式：`PLATFORM_{PLATFORM_ID}_ENABLED`（如 `PLATFORM_FEISHU_ENABLED`）
- 布尔值解析支持：1/true/yes/on（启用）和 0/false/no/off（禁用）

### TypeScript 类型设计
- 使用 `interface` 而非 `type` 定义 `PlatformAdapter`，便于未来扩展
- `platformId` 使用 `readonly` 防止意外修改
- `enabled` 为可选属性，支持运行时覆盖

### API 设计
- `register()` - 注册适配器，防重复
- `get()` - 查询单个适配器
- `list()` - 列出所有适配器
### API 设计
- `register()` - 注册适配器，防重复
- `get()` - 查询单个适配器
- `list()` - 列出所有适配器
- `listEnabled()` - 列出启用的适配器
- `isEnabled()` - 检查指定平台是否启用

## 2026-03-04 Task: 会话键命名空间策略与兼容迁移

### 实现要点
- 会话键采用命名空间格式：`{platform}:{chatId}`（如 `feishu:ou_xxx`）
- 默认平台为 `feishu`，确保向后兼容
- 读取优先检查命名空间键，回退到旧版 `chatId` 键
- 写入始终使用命名空间键（新策略）
- `getAllChatIds()` 自动转换键格式返回旧版格式

### 命名规范
- 分隔符：`:`（冒号）
- 平台 ID 类型：`type PlatformId = string`
- 辅助方法：
  - `makeConversationKey(platform, chatId)` - 生成命名空间键
  - `parseConversationKey(key)` - 解析命名空间键
  - `isNamespacedKey(key)` - 判断是否为命名空间键
  - `legacyToNamespacedKey(chatId)` - 旧键转命名空间键

### 兼容性保证
- 旧数据 `chatId` 键可读取（`getSessionId`, `getSession`）
- 新写入自动转换为命名空间键（`setSession`, `removeSession`）
- `getChatId(sessionId)` 支持两种键格式
- `getAllChatIds()` 返回旧版格式以兼容下游调用

### API 变更
- `getSessionId(chatId)` - 读取时优先查命名空间键
- `getSession(chatId)` - 读取时优先查命名空间键
- `setSession(chatId, ...)` - 写入时使用命名空间键
- `removeSession(chatId)` - 删除时优先删除命名空间键
- `isSessionDeleteProtected(chatId)` - 读取时优先查命名空间键
- `isPrivateChatSession(chatId)` - 读取时优先查命名空间键
- `isGroupChatSession(chatId)` - 读取时优先查命名空间键
- `updateConfig(chatId, ...)` - 读取时优先查命名空间键
- `updateTitle(chatId, ...)` - 读取时优先查命名空间键
- `updateResolvedDirectory(chatId, ...)` - 读取时优先查命名空间键
- `addInteraction(chatId, ...)` - 读取时优先查命名空间键
- `popInteraction(chatId)` - 读取时优先查命名空间键
- `getLastInteraction(chatId)` - 读取时优先查命名空间键
- `findInteractionByBotMsgId(chatId, ...)` - 读取时优先查命名空间键
- `updateInteraction(chatId, ...)` - 读取时优先查命名空间键
- `updateLastInteraction(chatId, ...)` - 读取时优先查命名空间键
- `getAllChatIds()` - 返回旧版格式（兼容性转换）

### 调用方注意事项
- 所有调用方传入 `chatId` 参数即可，无需修改
- 下游调用 `getAllChatIds()` 接收旧版格式
- 会话别名（session alias）继续使用 `chatId` 作为 key

## 2026-03-04 Task: 定义平台通用事件与适配器接口

### 实现要点
- 文件位置：`src/platform/types.ts`（新建）
- 类型定义严格使用 TypeScript 接口和类型别名
- 保持字段最小化，仅包含当前 Feishu 流程所需的字段
- 支持可选字段（`threadId`, `chatType`, `attachments`, `mentions`）以适应不同平台

### 类型设计模式
- `PlatformMessageEvent`：入站消息的通用抽象
  - 核心字段：`platform`, `conversationId`, `messageId`, `senderId`, `content`
  - 平台特定字段：`msgType`, `threadId`, `chatType`, `attachments`, `mentions`
  - 原始事件：`rawEvent` 保留调试和平台特定处理能力
  
- `PlatformActionEvent`：卡片/按钮点击等交互
  - 核心字段：`platform`, `senderId`, `action`, `token`
  - 关联字段：`messageId`, `conversationId`, `threadId`（可选）
  - 动作数据结构：`{ tag: string, value: Record<string, unknown> }`

- `PlatformSender`：出站消息发送抽象
  - 必需方法：`sendText`, `sendCard`, `updateCard`, `deleteMessage`
  - 可选方法：`reply`, `replyCard`（Feishu 等平台支持）

- `PlatformAdapter`：平台适配器接口
  - 生命周期：`start()`, `stop()`
  - 事件监听：`onMessage`, `onAction`
  - 辅助监听：`onChatUnavailable`, `onMessageRecalled`, `onMemberLeft`, `onChatDisbanded`

### Feishu 事件映射
- `FeishuMessageEvent` → `PlatformMessageEvent`：1:1 字段对应
  - `chatId` → `conversationId`
  - `msgType` 直接保留
  - `attachments` 结构兼容

- `FeishuCardActionEvent` → `PlatformActionEvent`：
  - `openId` → `senderId`
  - `chatId` → `conversationId`
  - `action` 结构保持一致

### 验证结果
- `npm run build` 通过，无类型错误
- `lsp_diagnostics` 无警告或错误
- 所有类型定义都使用了明确的类型，未使用 `any`

## 2026-03-04 Task: 修复 Task 2 验证问题

### 去除重复类型定义
- 移除了 registry.ts 中本地的 `PlatformAdapter` 接口定义
- 改为从 `./types.ts` 导入共享的 `PlatformAdapter`
- 使用 `adapter.platform` 替代 `adapter.platformId`（对齐共享契约）

### 环境变量配置调整
- 移除了对 `adapter.enabled` 属性的依赖（共享契约中不包含此字段）
- 简化启用逻辑：环境变量 > 默认策略
- 保持了 Feishu 默认启用的向后兼容性

### tsconfig.json 变更
- 移除了 `"types": ["node"]` 配置（构建不需要，通过依赖自动解析）
- 保持了原有配置，避免不必要的配置扩散

## 2026-03-04 Task: 特性开关与双轨路由模式接入

### 实现要点
- 路由器模式配置: `ROUTER_MODE=legacy|dual|router`，默认 `legacy`
- 平台启用列表: `ENABLED_PLATFORMS` 逗号分隔，不限制时默认所有平台可用
- 默认模式为 `legacy`，确保现有部署不受影响
- `dual` 模式用于 A/B 对比测试，不改变当前行为，仅记录日志
- 使用 TypeScript 类型断言确保模式值合法
- 配置解析在 `src/config.ts` 中，启动时在 `src/index.ts` 中打印

### 安全默认值
- 环境变量缺失或无效时回退到 `legacy` 模式
- `ENABLED_PLATFORMS` 为空时认为所有平台可用（由各自的启用状态控制）
- 平台 ID 比较使用 `toLowerCase()` 确保大小写不敏感

### TypeScript 类型设计
- `mode: 'legacy' | 'dual' | 'router'` 使用字面量联合类型
- `enabledPlatforms: string[]` 使用数组存储
- `isPlatformEnabled(platformId: string): boolean` 提供运行时查询能力

### 启动日志
- 始终输出当前路由器模式
- 输出平台过滤状态（已指定/未指定）
- `dual` 模式额外输出警告提示

## 2026-03-04 Task: 创建 Root Router 骨架

### 实现要点
- 文件位置：`src/router/root-router.ts`（新建）
- 路由器仅负责事件分发，不包含业务逻辑（pass-through 模式）
- 通过回调注入方式连接 index.ts 中的 timeline 等上下文
- 保持 Feishu 现有行为不变，仅替换事件入口

### API 设计
- `onMessage(event)` - 处理平台消息事件（入站消息）
- `onAction(event)` - 处理平台动作事件（卡片/按钮交互）
- `onOpenCodeEvent(event)` - 处理 OpenCode 内部事件（占位符）
- `setTimelineCallbacks(callbacks)` - 注入 timeline 回调

### 回调注入模式
- `TimelineCallbacks` 接口定义外部依赖
- `upsertTimelineNote` 回调用于更新 timeline
- 注入点在 index.ts 中，在 main() 函数开始处调用

### 事件入口迁移
- 原 `feishuClient.on('message', ...)` 改为 `rootRouter.onMessage(event)`
- 原 `feishuClient.setCardActionHandler(...)` 改为 `rootRouter.onAction(event)`
- 业务逻辑（权限处理、question 处理等）迁移到 router 内部

### 验证结果
- `npm run build` 通过，无类型错误
- Feishu 行为保持不变（pass-through 语义）

## 2026-03-04 Task: T3 Root Router 纯编骨骼架重构

## 2026-03-04 Task: T3 Root Router 纯编排骨架重构

### 实现要点
- RootRouter 改为纯编排路由，不再包含业务逻辑
- 业务逻辑通过回调注入（PermissionActionCallbacks, QuestionActionCallbacks）
- 新建 action-handlers.ts 封装权限和问题处理逻辑

### 实现要点
- RootRouter 改为纯编排路由，不再包含业务逻辑
- 业务逻辑通过回调注入（PermissionActionCallbacks, QuestionActionCallbacks）
- 新建 action-handlers.ts 封装权限和问题处理逻辑
- index.ts 在初始化时注入回调实现

### 回调接口设计
- PermissionActionCallbacks: handlePermissionAction, tryHandlePendingPermissionByText
- QuestionActionCallbacks: handleQuestionSkipAction
- 工厂函数: createPermissionActionCallbacks, createQuestionActionCallbacks

### 职责划分
- RootRouter: 仅负责事件分发，根据 action 类型委托给对应处理器
- action-handlers.ts: 包含具体的权限/问题处理业务逻辑
- index.ts: 创建回调实例并注入到 router

### 验证结果
- npm run build 通过
- LSP diagnostics 无错误
\n## 2026-03-04 Task: T9 OpenCode 事件分发器抽取\n\n### 实现要点\n- 文件位置: `src/router/opencode-event-hub.ts`（新建）\n- 统一管理 7 种 OpenCode 事件监听: permissionRequest, sessionStatus, sessionIdle, messageUpdated, sessionError, messagePartUpdated, questionAsked\n- 通过上下文注入模式接收 index.ts 中的闭包状态和辅助函数\n- 保持单监听器架构: 每种事件类型仅注册一次\n\n### 设计模式\n- **依赖注入**: 所有状态和辅助函数通过 `OpenCodeEventContext` 接口传入\n- **单例模式**: `openCodeEventHub` 作为模块级单例导出\n- **注册守卫**: `register()` 方法有 `registered` 标志防止重复注册\n\n### 迁移内容\n- 从 `index.ts` 移除了 7 个 `opencodeClient.on(...)` 调用\n- 事件处理逻辑完整保留，包括:\n  - 权限请求处理（白名单检查、入队、timeline 更新）\n  - 会话状态变化（重试提示、idle 完成）\n  - 消息更新（openCodeMsgId 记录、错误处理）\n  - 流式输出处理（tool/subtask 状态、retry/compaction 通知）\n  - 问题注册（question 交互）\n\n### 验证结果\n- `npm run build` 通过\n- listener 数量不变: 7 个 OpenCode 事件监听器全部迁移到 hub\n- 行为等价: 所有事件处理逻辑保持不变

## 2026-03-04 Task: T10 抽象输出发送接口并接入 FeishuSender

### 实现要点
- 将 `outputBuffer.setUpdateCallback` 中的直接 `feishuClient` 调用改为通过 `PlatformSender` 接口
- 复用 `feishuAdapter.getSender()` 获取发送器实例
- 保持流式卡片更新策略：先更新现有卡片，失败则发送新卡片并删除旧卡片

### 代码变更
- `src/index.ts`:
  - 新增导入 `feishuAdapter`
  - 将 `feishuClient.sendCard/updateCard/deleteMessage` 替换为 `sender.sendCard/updateCard/deleteMessage`
  - sender 通过 `feishuAdapter.getSender()` 获取

### 行为等价性
- 流式卡片更新策略不变：
  1. 优先更新现有卡片 (`sender.updateCard`)
  2. 更新失败则发送新卡片 (`sender.sendCard`) 并删除旧卡片 (`sender.deleteMessage`)
  3. 清理冗余卡片消息
- `buildStreamCards` 视觉行为不变
- 所有 FeishuSender 方法委托给 feishuClient，行为完全一致

### 验证结果
- `npm run build` 通过
- LSP diagnostics 无错误

- `npm run build` 通过
- LSP diagnostics 无错误

## 2026-03-04 Task: T11 建立飞书回归守护测试脚手架（tests-after）

### 实现要点
- 框架选择: Vitest (v4.0.18)，配置文件 `vitest.config.ts`
- 依赖添加: `vitest` 作为 devDependency
- 测试目录: `tests/*.test.ts`
- 脚本: `npm run test` (单次运行), `npm run test:watch` (监听模式)

### 覆盖场景
1. **chat-session namespaced/legacy 兼容性** (tests/chat-session.test.ts, 9 测试用例)
   - 旧格式 chatId 读取支持（向后兼容）
   - 新格式 namespaced key (feishu:chatId) 支持
   - namespaced 优先级高于 legacy
   - 配置更新正确作用于 namespaced key
   - legacy 迁移到 namespaced 时的别名机制
   - 别名过期时间（默认 10 分钟）
   - 私聊/群聊判断（显式 chatType 和隐式 title 推断）
   - getChatId 反向查找正确解析 namespaced key

2. **router config 解析 fallback 行为** (tests/router-config.test.ts, 5 测试用例)
   - ROUTER_MODE 默认值为 legacy
   - ENABLED_PLATFORMS 默认为空数组（不限制）
   - isPlatformEnabled 在未设置平台列表时返回 true
   - ROUTER_MODE 只接受有效值（通过实际运行时配置验证）
   - ENABLED_PLATFORMS 格式校验（字符串数组，小写转换）

3. **directory policy 路径规范化与安全** (tests/directory-policy.test.ts, 35 测试用例)
   - 路径规范化: 相对路径、`..`、`.`、重复分隔符
   - 危险路径拦截: Windows UNC 路径、Linux 系统敏感路径
   - 路径允许检查: 完全匹配、子路径、大小写忽略
   - 目录解析优先级: explicit > alias > chat_default > env_default > server_default
   - 错误处理: 相对路径拒绝、过长路径拒绝、危险路径拒绝
   - 允许列表校验

### 测试隔离
- chat-session 测试使用独立存储文件 `.chat-sessions.test.json`
- beforeEach/afterEach 备份/恢复实际存储文件
- 清空 data 和 sessionAliases 确保测试独立性

### 平台差异处理
- directory-policy 测试在 Windows 和 Linux 上有不同断言
- 路径格式: Windows 使用反斜杠，Linux 使用正斜杠
- 危险路径列表: Linux 拦截系统目录，Windows 拦截 UNC 路径

### 验证结果
- `npm run build` 通过
- `npx vitest run` 全部通过: 49 tests passed
- 无外部网络依赖，纯本地执行


## 2026-03-04 Task: T12 Discord 适配器脚手架

### 实现要点
- 文件位置: `src/platform/adapters/discord-adapter.ts`（新建）
- 最小骨架实现: 实现 `PlatformAdapter` 接口，暂无真实 ingress-egress
- 默认禁用策略: `DISCORD_ENABLED` 环境变量默认为 false
- Token 缺失降级: `DISCORD_TOKEN` 缺失时警告日志 + 跳过激活
- 启动隔离: Discord 适配器 start() 失败不阻塞 Feishu 启动

### Default-off 行为
- 环境变量: `PLATFORM_DISCORD_ENABLED` (或 `DISCORD_ENABLED`)，默认 false
- 回退检查: `process.env.DISCORD_TOKEN` 存在时才真正激活
- 启动日志: 输出 Discord 适配器启用/禁用状态

### Missing Token Degrade 行为
- 缺失检测: `DISCORD_TOKEN` 环境变量未设置或为空
- 降级处理: 输出警告日志 "Discord adapter disabled: missing DISCORD_TOKEN"，返回 `enabled: false`
- 不抛异常: 不阻塞系统启动，静默降级

### Index 启动隔离
- try-catch 包装: `discordAdapter.start()` 被包裹在 try-catch 中
- 失败处理: 仅输出错误日志，不中断主流程
- Feishu 优先: Feishu 适配器先启动，不受 Discord 影响

### 验证证据
- **build pass**: `npm run build` 通过，无类型错误
- **vitest pass**: `npx vitest run` 全部通过（49 tests）
- **runtime smoke**: 缺失 `DISCORD_TOKEN` 时启动成功，输出警告日志但不阻塞

## 2026-03-04 Task: T16 端到端联调与灰度验收收口

### 实现要点

- **路由器模式三阶段验收**：legacy → dual → router
- **灰度 SOP 文档化**：添加到 README.md 和证据文件
- **回滚路径清晰**：ROUTER_MODE=legacy 即可回滚

### 验证结果

| 验证项 | Status | 说明 |
|--------|--------|------|
| Legacy 模式 | ✅ PASS | 启动日志正确，行为与旧版一致 |
| Dual 模式 | ✅ PASS | 双轨日志字段完整，警告提示清晰 |
| Router 模式 | ✅ PASS | 事件分发正常，行为等价 |
| 构建测试 | ✅ PASS | 无类型错误，构建通过 |
| 单元测试 | ✅ PASS | 53 tests passed |

### 灰度部署 SOP

#### 启用条件

- [x] 本地三阶段验证全部通过 (legacy/dual/router)
- [x] 单元测试通过率 ≥ 95% (当前: 100%)
- [x] 构建无错误无警告
- [x] 代码审查通过 (至少 1 名 reviewer)

#### 启用步骤

```bash
# 方式 A: 临时设置 (命令行)
ROUTER_MODE=dual node scripts/start.mjs

# 方式 B: 永久设置 (.env 文件)
echo "ROUTER_MODE=dual" >> .env

# 方式 C: Docker 环境
# 在 docker-compose.yml 中添加:
# environment:
#   - ROUTER_MODE=dual
```

#### 观察指标

| 指标项 | 正常范围 | 告警阈值 |
|--------|----------|----------|
| 消息延迟 | < 500ms | > 1000ms |
| 错误率 | < 0.1% | > 1% |
| 卡片更新成功率 | > 99% | < 95% |
| 会话绑定成功率 | > 99% | < 90% |

#### 回滚触发条件

| 触发条件 | 响应级别 | 说明 |
|----------|----------|------|
| 消息延迟 > 2s | P0 | 严重影响用户体验 |
| 错误率 > 5% | P0 | 系统异常率过高 |
| 权限卡/提问卡失效 | P0 | 功能严重降级 |
| 会话绑定失败率 > 10% | P1 | 影响多会话管理 |

#### 回滚步骤

```bash
# 1. 停止服务
node scripts/stop.mjs

# 2. 设置回滚模式
echo "ROUTER_MODE=legacy" > .env

# 3. 重启服务
node scripts/start.mjs

# 4. 验证回滚成功
grep "路由器模式" logs/service.log
# 期望输出: [Config] 路由器模式: legacy
```

### 证据文件

| 文件路径 | 说明 |
|----------|------|
| `.sisyphus/evidence/task-16-rollout-gate.txt` | 三阶段验收证据 |
| `.sisyphus/evidence/task-16-fallback-recovery.txt` | 详细回滚 SOP |

### 相关配置

| 文件 | 说明 |
|------|------|
| `src/config.ts` | 路由器模式配置 |
| `src/index.ts` | 启动时模式日志输出 |
| `src/router/root-router.ts` | 根路由器实现 |

### 关键设计决策

1. **默认 legacy 模式**：确保现在线上部署不受影响
2. **dual 模式日志对比**：记录新的路由决策与旧版对比
3. **ROUTER_MODE 回退机制**：无效值自动回退到 legacy
4. **双轨日志字段**：`platform/conversationKey/sessionId/routeDecision`

### 后续工作

- **生产灰度部署**：按 SOP 执行三阶段灰度
- **监控告警接入**：接入监控系统，自动告警异常
- **自动化回滚**：必要时可配置自动回滚策略

---



## 2026-03-04 Task: F3 Real Manual QA

### 验证要点

- **三模式启动验证**: legacy/dual/router 三种模式均通过真实启动测试
- **Dual 模式日志**: 必须出现两条提示（⚠️ 双轨模式警告 + 📝 回滚提示），且不重复
- **Router/Legacy 模式**: 不应出现 dual 提示日志
- **Edge Case**: OpenCode 不可达时输出 `[OpenCode] 服务器状态异常: fetch failed` 并以 exit code 1 退出

### Windows 环境变量传递注意事项

- Windows `set VAR=value && command` 在某些 bash 环境下不生效
- 推荐使用 Node.js spawn 方式传递环境变量:
  ```javascript
  const { spawn } = require('child_process');
  const env = { ...process.env, ROUTER_MODE: 'dual' };
  spawn('node', ['dist/index.js'], { env, stdio: 'inherit' });
  ```

### Discord 缺 Token 行为

- 缺失 `DISCORD_TOKEN` 时输出警告但不阻塞 Feishu 启动
- 日志: `[Discord] 适配器未启用，跳过启动`
- 符合 default-off 策略

### 回滚路径验证

- `ROUTER_MODE=legacy` 配置立即生效
- 无需重新构建，仅重启服务即可
- 启动日志正确反映当前模式

### QA 证据文件位置

- `.sisyphus/evidence/final-f3-manual-qa.txt`

---
