## 2026-03-04T00:00:00Z Task: init
初始化记录：用于沉淀架构与实现决策。

## 2026-03-04 Task: 建立平台注册中心与能力查询

### 架构决策
1. **最小化依赖**：注册中心不依赖 Feishu SDK 或其他平台特定逻辑，保持通用性
2. **环境变量优先**：启用状态可通过环境变量灵活控制，无需修改代码
3. **向后兼容**：feishu 默认启用，确保现有部署不受影响
4. **确定性 API**：所有函数都是纯函数（无副作用），便于测试和预测
5. **安全降级**：未注册的平台查询返回 `undefined`/`false`，不抛出异常

### 实现策略
- 使用 `Map` 而非对象字面量存储，保持插入顺序且性能更佳
- 平台 ID 不区分大小写比较（仅默认策略），其他地方保留原样
- 布尔值解析统一归一化处理，支持多种常见格式

### 为什么不使用 `any`
- 严格遵守类型安全，`PlatformAdapter` 明确定义所有字段
### 为什么不使用 `any`
- 严格遵守类型安全，`PlatformAdapter` 明确定义所有字段
- `process.env` 访问使用可选链和显式类型检查
- 环境变量解析前进行规范化（trim、toLowerCase）

## 2026-03-04 Task: 会话键命名空间策略与兼容迁移

### 架构决策
1. **命名空间格式**：`{platform}:{chatId}`（如 `feishu:ou_xxx`, `discord:channel_xxx`）
2. **默认平台**：`feishu` 作为默认平台，确保向后兼容
3. **懒迁移策略**：旧数据保留，首次访问时记录日志，写入时自动转换为命名空间键
4. **向下兼容**：`getAllChatIds()` 返回旧版格式，确保下游调用无需修改
5. **单一存储**：继续使用单个 `.chat-sessions.json` 文件，不引入额外存储

### 实现策略
- 所有读取操作优先检查命名空间键（`legacyToNamespacedKey`），回退到旧版键
- 所有写入操作使用命名空间键，确保新数据格式统一
- `removeSession` 同时尝试删除命名空间键和旧版键（防御性删除）
- 别名系统继续使用 `chatId`，避免引入更复杂的设计

### 为什么不使用 `any`
- `PlatformId` 明确定义为 `type PlatformId = string`
- `makeConversationKey` 等辅助函数严格类型化
- 读取方法返回 Union Type，确保调用方处理所有可能情况

## 2026-03-04 Task: 定义平台通用事件与适配器接口

### 架构决策
1. **最小化字段集合**：仅包含当前 Feishu 流程必需的字段，避免过度抽象
2. **平台标识显式化**：所有事件类型都包含 `platform` 字段，明确平台来源
3. **原始事件保留**：通过 `rawEvent: unknown` 保留原始平台事件，支持调试和平台特定处理
4. **可选字段策略**：`threadId`, `chatType`, `attachments`, `mentions` 等设为可选，适应不同平台能力
5. **方法接口分离**：`PlatformAdapter` 和 `PlatformSender` 分离，职责清晰

### 实现策略
- 使用 `interface` 定义复合类型（事件、适配器）
- 使用 `type alias` 定义简单类型（`PlatformId`, `ChatType`, `SenderType`）
- `PlatformSender` 的 `reply` 和 `replyCard` 方法标记为可选，因为不是所有平台都支持
- `PlatformAdapter` 的事件监听方法使用可选链，支持不同平台能力差异

### 为什么不使用 `any`
- `rawEvent` 使用 `unknown` 而非 `any`，强制类型检查
- `action.value` 使用 `Record<string, unknown>`，提供类型安全
- 所有可选字段都有明确的类型定义，不使用 `any` 作为默认值

### 字段命名规范
- 会话 ID 使用 `conversationId`（平台原生 ID，非命名空间键）
- 消息 ID 使用 `messageId`
- 发送者 ID 使用 `senderId`
- 线程 ID 使用 `threadId`
- 文件键使用 `fileKey`

## 2026-03-04 Task: 修复 Task 2 验证问题

### 去除范围蔓延的决策
1. **移除重复类型**：registry.ts 不应定义自己的 `PlatformAdapter`，应使用共享契约
2. **对齐字段命名**：使用 `adapter.platform`（共享契约）而非 `adapter.platformId`（本地定义）
3. **移除非必要配置**：tsconfig.json 中的 `"types": ["node"]` 不是必需的，依赖包已包含类型定义

### 保留的核心行为
- 环境变量过滤逻辑保持不变
- Feishu 默认启用策略保持不变
- 所有导出 API 保持不变
- 运行时行为完全保持一致

### 为什么使用共享契约
- 避免类型定义在不同模块间不一致
- 适配器契约由 `types.ts` 统一管理
- 注册中心只负责注册和查询，不定义适配器接口

## 2026-03-04 Task: 特性开关与双轨路由模式接入

### 架构决策
1. **安全默认值**：所有配置都有明确的 fallback 值，缺失配置不影响启动
2. **环境变量驱动**：通过环境变量控制模式切换，无需修改代码
3. **向后兼容优先**：默认 legacy 模式，确保现有部署继续工作
4. **渐进式迁移**：dual 模式用于对比测试，router 模式用于完全切换
5. **平台过滤解耦**：平台启用由两个维度控制（全局列表 + 各自启用状态）

### 实现策略
- 使用立即执行函数（IIFE）解析配置，保持配置对象纯净
- 类型断言仅在已验证合法值上使用，避免运行时错误
- 平台列表解析时过滤空项，减少无效数据
- 查询方法使用 `toLowerCase()` 统一比较，提升鲁棒性

### 为什么使用 IIFE
- 配置对象保持简洁，避免暴露中间变量
- 初始化逻辑在导入时完成一次，运行时开销为零
- 类型推断更准确，TypeScript 能正确推断返回类型

### 为什么支持未指定平台列表
- 允许各个平台独立控制启用状态（环境变量 `PLATFORM_{PLATFORM_ID}_ENABLED`）
- 避免双重要求，降低配置复杂度
- 单一部署时可只关注环境变量，无需关心平台列表

## 2026-03-04 Task: 创建 Root Router 骨架

### 架构决策
1. **薄路由层原则**：路由器仅负责事件分发，不包含业务逻辑
2. **回调注入模式**：通过 `setTimelineCallbacks()` 注入外部依赖，避免循环引用
3. **保持 Feishu 行为不变**：所有逻辑从 index.ts 迁移，但语义完全一致
4. **单例模式**：`rootRouter` 作为单例导出，确保全局唯一入口

### 实现策略
- 路由器方法签名支持 `FeishuMessageEvent | PlatformMessageEvent`，为多平台扩展做准备
- 当前实现直接 cast 为 Feishu 类型，保持 legacy 兼容
- `dual` 模式下记录日志但不改变行为，用于 A/B 测试

### 为什么使用回调注入而非直接导入
- 避免 router 模块对 index.ts 的循环依赖
- 保持 router 模块的独立性，便于测试和复用
- 未来可扩展为多实例部署（每个实例注入不同的回调）

### 迁移范围
- 消息处理（p2p/group）入口
- 卡片动作处理入口
- 权限文本处理逻辑
- 权限按钮处理逻辑
- 问题跳过处理逻辑

### 保留在 index.ts 的逻辑
- OpenCode 事件监听（permissionRequest, messagePartUpdated 等）
- Timeline 状态管理（streamTimelineMap 等）
- 输出缓冲回调（outputBuffer.setUpdateCallback）
- 生命周期事件（onMemberLeft, onChatDisbanded 等）

## F1 Plan Compliance Audit Decision (2026-03-04)
- **Verdict**: APPROVE
- **Must Have**: 3/3 satisfied
- **Must NOT Have**: 4/4 satisfied  
- **Tasks**: 17/17 completed
- **Key Evidence**: Single OpenCode listener maintained, Feishu parity verified through three-phase rollout, namespaced session keys implemented with legacy compatibility, dual-mode logging for safe transition
