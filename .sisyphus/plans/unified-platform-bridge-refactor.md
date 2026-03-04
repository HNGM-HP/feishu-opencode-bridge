# 统一平台桥接系统重构落地方案（飞书零回归 + Discord 首扩）

## TL;DR

> **Quick Summary**: 采用“薄适配器 + 中央路由 + 单一 OpenCode 事件监听”渐进重构，先保证飞书行为零回归，再按开关灰度接入 Discord。
>
> **Deliverables**:
> - 平台抽象层（Platform Adapter + Router + Registry）
> - 会话键命名空间化（兼容旧 `chatId` 数据）
> - 保持单一 OpenCode 监听并按会话平台分发输出
> - Discord 首批接入（默认关闭，灰度启用）
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 implementation waves + final verification wave
> **Critical Path**: T1 → T3 → T8 → T12 → T16

---

## Context

### Original Request
在不改变原有飞书功能的前提下，把当前 Feishu-OpenCode 桥接重构为可扩展多平台架构，并对给定规划中的不合理点进行修正，产出可真实落地的实施方案。

### Interview Summary
**Key Discussions**:
- 保持现有飞书闭环能力（权限/提问/流式/撤回/清理）不变。
- 架构方向采用“轻量容器化思想”的可落地版本，而非大爆炸式重写。
- 测试策略确定为“先实现后补测”。
- 第一批扩展平台优先 Discord。

**Research Findings**:
- `src/index.ts` 是当前编排瓶颈与单入口。
- OpenCode 事件监听已是单点注册，属于可保留优势。
- `src/store/chat-session.ts` 的 `chatId` 主键是跨平台扩展关键阻塞点。
- 业界模式建议：薄适配器 + 中央路由，避免过早抽象统一事件模型。

### Metis Review
**Identified Gaps** (addressed):
- 补充了“零人工干预”的可执行验收原则。
- 补充了严格范围边界，避免顺带做业务增强。
- 补充了回滚与灰度守护线（特性开关 + 双轨期）。

---

## Work Objectives

### Core Objective
在保持飞书行为语义不变的前提下，建立可扩展平台桥接底座，使 Discord 可作为首个增量平台接入，并保证 OpenCode 事件流仍为单监听单分发。

### Concrete Deliverables
- 新增平台抽象与注册机制（adapter/registry/router）。
- 会话绑定支持 `{platform}:{conversationId}` 命名空间键，并兼容历史数据。
- `src/index.ts` 从“直接耦合飞书”迁移到“路由 + 平台实现”接线。
- Discord 基础适配器与接线（默认关闭）。

### Definition of Done
- [ ] `npm run build` 通过。
- [ ] 飞书关键链路回归验证全部通过（命令见 Verification Strategy）。
- [ ] 在启用 Discord 开关时，可建立独立会话并接收 OpenCode 输出。

### Must Have
- 保留单一 OpenCode 事件监听点（不得按平台重复注册）。
- 飞书现有命令与交互语义保持一致。
- 所有任务均提供 Agent-Executed QA Scenarios。

### Must NOT Have (Guardrails)
- 禁止一次性替换全部 handler/卡片渲染逻辑（避免大爆炸重写）。
- 禁止提前设计“全平台统一超大事件 schema”。
- 禁止为每个平台创建独立 OpenCode SSE 监听器。
- 禁止将本轮范围扩展到非桥接功能（如业务命令增强）。

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: Tests-after
- **Framework**: vitest（在本计划中补建）
- **If TDD**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright（如涉及卡片网页预览可选）
- **CLI/TUI**: interactive_bash（用于服务运行态与日志观察）
- **API/Backend**: Bash（调用本地 bridge + OpenCode 接口/脚本）
- **Module**: Bash (`npm run build`, `node dist/index.js`, targeted test command)

**Global verification commands (post-implementation)**:
```bash
npm run build
npx vitest run
node dist/index.js
```

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Start Immediately — foundation + compatibility scaffolding):
├── Task 1: 平台域模型与适配器接口定义 [quick]
├── Task 2: 平台注册中心与能力探测 [quick]
├── Task 3: Root Router 骨架与统一入口协议 [unspecified-high]
├── Task 4: 会话键命名空间策略与兼容映射设计 [deep]
└── Task 5: 特性开关与双轨路由开关接入 [quick]

Wave 2 (After Wave 1 — Feishu migration without behavior change):
├── Task 6: FeishuAdapter 包装层（透传现有 client）[unspecified-high]
├── Task 7: 入站消息/卡片动作经 Router 分发 [deep]
├── Task 8: `chat-session` 存储升级为平台命名空间键 [deep]
├── Task 9: OpenCode 事件分发器抽取（保持单监听）[unspecified-high]
├── Task 10: 输出发送接口抽象（Feishu sender adapter）[unspecified-high]
└── Task 11: 飞书回归守护测试与证据采集脚手架 [quick]

Wave 3 (After Wave 2 — Discord first integration + rollout guardrails):
├── Task 12: DiscordAdapter 最小可运行实现（text ingress/egress）[unspecified-high]
├── Task 13: Discord 会话绑定与路由接线 [deep]
├── Task 14: 平台隔离清理策略（lifecycle 分平台）[unspecified-high]
├── Task 15: 双轨对比日志与回滚开关完善 [quick]
└── Task 16: 端到端联调与灰度验收流程固化 [deep]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: T1 → T3 → T8 → T12 → T16
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6 (Wave 2)

### Dependency Matrix (FULL)

- **T1**: Blocked By=None | Blocks=T3,T6,T12
- **T2**: Blocked By=None | Blocks=T3,T5,T12
- **T3**: Blocked By=T1,T2 | Blocks=T7,T9,T13
- **T4**: Blocked By=None | Blocks=T8,T13,T14
- **T5**: Blocked By=T2 | Blocks=T15,T16
- **T6**: Blocked By=T1 | Blocks=T7,T10
- **T7**: Blocked By=T3,T6 | Blocks=T11,T16
- **T8**: Blocked By=T4 | Blocks=T9,T13,T14
- **T9**: Blocked By=T3,T8 | Blocks=T10,T16
- **T10**: Blocked By=T6,T9 | Blocks=T16
- **T11**: Blocked By=T7 | Blocks=T16
- **T12**: Blocked By=T1,T2 | Blocks=T13,T16
- **T13**: Blocked By=T3,T8,T12 | Blocks=T16
- **T14**: Blocked By=T4,T8 | Blocks=T16
- **T15**: Blocked By=T5 | Blocks=T16
- **T16**: Blocked By=T5,T7,T9,T10,T11,T12,T13,T14,T15 | Blocks=F1,F2,F3,F4

### Agent Dispatch Summary

- **Wave 1**: T1 `quick`, T2 `quick`, T3 `unspecified-high`, T4 `deep`, T5 `quick`
- **Wave 2**: T6 `unspecified-high`, T7 `deep`, T8 `deep`, T9 `unspecified-high`, T10 `unspecified-high`, T11 `quick`
- **Wave 3**: T12 `unspecified-high`, T13 `deep`, T14 `unspecified-high`, T15 `quick`, T16 `deep`
- **FINAL**: F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

---

- [ ] 1. 定义平台通用事件与适配器接口

  **What to do**:
  - 新建 `src/platform/types.ts`，定义 `PlatformMessageEvent`、`PlatformActionEvent`、`PlatformAdapter`、`PlatformSender`。
  - 定义最小字段集合（`platform`, `conversationId`, `messageId`, `senderId`, `payload`），避免过度通用化。
  - 保持与现有 `FeishuMessageEvent` 可一一映射。

  **Must NOT do**:
  - 不引入超大“万能事件”对象。
  - 不改动现有飞书 handler 行为。

  **Recommended Agent Profile**:
  - **Category**: `quick` - 以类型与接口定义为主。
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 保证接口边界清晰。
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 无 UI 设计需求。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T4, T5)
  - **Blocks**: T3, T6, T12
  - **Blocked By**: None

  **References**:
  - `src/feishu/client.ts:147` - 现有消息事件字段来源。
  - `src/index.ts:1003` - 当前入站消费点。
  - `src/handlers/group.ts:122` - 现有消费方所需字段集合。

  **Acceptance Criteria**:
  - [ ] `src/platform/types.ts` 可被 `tsc` 通过。
  - [ ] 现有文件编译无破坏性类型错误。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 类型契约可编译（happy path）
    Tool: Bash
    Preconditions: 新增接口文件已保存
    Steps:
      1. 运行 `npm run build`
      2. 断言输出无 TS error
    Expected Result: 构建成功退出码 0
    Failure Indicators: 任意与 platform types 相关 TS 报错
    Evidence: .sisyphus/evidence/task-1-build.txt

  Scenario: 接口最小化约束（edge case）
    Tool: Bash
    Preconditions: 尝试在调用点访问不存在字段
    Steps:
      1. 运行 `npm run build`
      2. 检查类型系统是否阻止未声明字段访问
    Expected Result: 非法字段访问被 TS 拦截
    Evidence: .sisyphus/evidence/task-1-type-guard.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): add platform adapter type contracts`
  - Files: `src/platform/types.ts`
  - Pre-commit: `npm run build`

- [ ] 2. 建立平台注册中心与能力查询

  **What to do**:
  - 新建 `src/platform/registry.ts`，提供 `register/get/list`。
  - 支持按 `platformId` 注册 `PlatformAdapter`。
  - 支持 `ENABLED_PLATFORMS` 过滤与能力查询。

  **Must NOT do**:
  - 不在注册中心里执行平台业务逻辑。
  - 不直接依赖 Feishu SDK。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 保证注册 API 简洁。
  - **Skills Evaluated but Omitted**:
    - `git-master`: 当前非 git 操作。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T4, T5)
  - **Blocks**: T3, T5, T12
  - **Blocked By**: None

  **References**:
  - `src/config.ts:117` - 目录与配置风格参照。
  - `src/index.ts:1003` - 后续注册中心接线位置。

  **Acceptance Criteria**:
  - [ ] 支持注册 `feishu` 并可 `get('feishu')`。
  - [ ] 禁用平台不参与 `listEnabled()`。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 注册与查询（happy path）
    Tool: Bash
    Preconditions: registry 已实现
    Steps:
      1. 运行最小脚本注册 feishu/discord
      2. 设置 `ENABLED_PLATFORMS=feishu`
      3. 断言 only feishu 被列出
    Expected Result: 返回列表仅包含 feishu
    Evidence: .sisyphus/evidence/task-2-registry.txt

  Scenario: 未注册平台查询（failure case）
    Tool: Bash
    Preconditions: 未注册 `wechat`
    Steps:
      1. 调用 `get('wechat')`
      2. 断言返回 undefined 或明确错误
    Expected Result: 系统稳定，不抛未处理异常
    Evidence: .sisyphus/evidence/task-2-missing-platform.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): add platform registry and enable filter`
  - Files: `src/platform/registry.ts`
  - Pre-commit: `npm run build`

- [ ] 3. 创建 Root Router 骨架（仅编排，不改行为）

  **What to do**:
  - 新建 `src/router/root-router.ts`，提供 `onMessage/onAction/onOpenCodeEvent`。
  - Router 只做分发，不承担平台 API 调用细节。
  - 先接旧 handler 透传，确保逻辑等价。

  **Must NOT do**:
  - 不在此任务重写 group/p2p 业务细节。
  - 不引入新事件监听器。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 保持边界与职责清晰。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 无浏览器交互。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (depends on T1,T2)
  - **Blocks**: T7, T9, T13
  - **Blocked By**: T1, T2

  **References**:
  - `src/index.ts:1003` - 当前 Feishu 入站 dispatch。
  - `src/index.ts:1205` - 当前 OpenCode 出站 dispatch。
  - `src/handlers/group.ts:122` - 群聊消息处理入口。
  - `src/handlers/card-action.ts:36` - 卡片动作入口。

  **Acceptance Criteria**:
  - [ ] Router 暴露三类入口方法并可被 index 接线。
  - [ ] 接线后飞书原路径行为不变。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Router 透传旧链路（happy path）
    Tool: Bash
    Preconditions: index 使用 Router 包装但仍调用旧 handler
    Steps:
      1. 启动服务 `node dist/index.js`
      2. 注入一条模拟 message 事件
      3. 断言最终进入 group/p2p 既有处理器
    Expected Result: 日志包含旧处理器标记且无行为差异
    Evidence: .sisyphus/evidence/task-3-router-pass-through.txt

  Scenario: 未注册平台事件（failure case）
    Tool: Bash
    Preconditions: Router 收到 unknown platform
    Steps:
      1. 发送 platform=unknown 的事件
      2. 断言记录 warning 并安全丢弃
    Expected Result: 进程不中断
    Evidence: .sisyphus/evidence/task-3-unknown-platform.txt
  ```

  **Commit**: YES
  - Message: `refactor(router): add root router orchestration skeleton`
  - Files: `src/router/root-router.ts`, `src/index.ts`
  - Pre-commit: `npm run build`

- [ ] 4. 会话键命名空间策略与兼容迁移

  **What to do**:
  - 在 `src/store/chat-session.ts` 引入 `conversationKey = {platform}:{chatId}`。
  - 保留历史 `chatId` 查询回退，写入时优先新键。
  - 增加小型迁移函数：读取旧记录后懒迁移为 `feishu:{chatId}`。

  **Must NOT do**:
  - 不删除旧数据读取能力。
  - 不改变 interactionHistory 语义。

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 兼容迁移策略设计。
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 非前端任务。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1,T2,T5)
  - **Blocks**: T8, T13, T14
  - **Blocked By**: None

  **References**:
  - `src/store/chat-session.ts:97` - 旧 `getSessionId(chatId)` 行为。
  - `src/store/chat-session.ts:118` - `getChatId(sessionId)` 反查逻辑。
  - `src/index.ts:1271` - 依赖 `sessionId->chatId` 的错误回传。

  **Acceptance Criteria**:
  - [ ] 旧 `chatId` 数据可继续读。
  - [ ] 新写入记录采用命名空间键。
  - [ ] `getChatId()` 对旧/新键都可命中。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 旧数据兼容读取（happy path）
    Tool: Bash
    Preconditions: .chat-sessions.json 含旧键 `oc_xxx`
    Steps:
      1. 启动服务加载 store
      2. 调用 getSessionId/getChatId
      3. 断言返回正确会话绑定
    Expected Result: 无迁移报错，读取成功
    Evidence: .sisyphus/evidence/task-4-legacy-read.txt

  Scenario: 新旧键冲突（failure case）
    Tool: Bash
    Preconditions: 同一 chat 存在旧键与新键
    Steps:
      1. 加载 store
      2. 执行冲突解析逻辑
    Expected Result: 新键优先且记录冲突告警
    Evidence: .sisyphus/evidence/task-4-key-conflict.txt
  ```

  **Commit**: YES
  - Message: `refactor(store): introduce namespaced conversation keys with legacy fallback`
  - Files: `src/store/chat-session.ts`
  - Pre-commit: `npm run build`

- [ ] 5. 特性开关与双轨路由模式接入

  **What to do**:
  - 新增 `ROUTER_MODE=legacy|dual|router`、`ENABLED_PLATFORMS` 配置解析。
  - `legacy` 默认：完全保持现有行为；`dual`：并行记录新路径日志但旧路径生效；`router`：新路径生效。

  **Must NOT do**:
  - 不将默认模式设为 `router`。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 配置语义一致性。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1,T2,T4)
  - **Blocks**: T15, T16
  - **Blocked By**: T2

  **References**:
  - `src/config.ts:3` - 现有 env 解析模式。
  - `src/index.ts:22` - 服务启动配置加载入口。

  **Acceptance Criteria**:
  - [ ] 未配置时默认 `legacy`。
  - [ ] `dual` 模式可输出比对日志。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 默认 legacy（happy path）
    Tool: Bash
    Steps:
      1. 不设置新 env 启动服务
      2. 检查日志模式
    Expected Result: 模式为 legacy，旧链路生效
    Evidence: .sisyphus/evidence/task-5-legacy-default.txt

  Scenario: 非法模式值（failure case）
    Tool: Bash
    Steps:
      1. 设置 ROUTER_MODE=invalid 启动
      2. 检查降级行为
    Expected Result: 回退 legacy 并打印告警
    Evidence: .sisyphus/evidence/task-5-invalid-mode.txt
  ```

  **Commit**: YES
  - Message: `feat(config): add router mode and platform feature flags`
  - Files: `src/config.ts`, `src/index.ts`
  - Pre-commit: `npm run build`

- [ ] 6. 实现 FeishuAdapter 包装层（行为透传）

  **What to do**:
  - 新建 `src/platform/adapters/feishu-adapter.ts`，封装 `feishuClient`。
  - 提供统一接口实现：事件标准化、发送器方法适配。
  - 保持内部仍调用现有 `src/feishu/client.ts`，不改飞书 API 细节。

  **Must NOT do**:
  - 不重写飞书客户端底层实现。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 适配层边界把控。
  - **Skills Evaluated but Omitted**:
    - `git-master`: 非 git 操作。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T7, T10
  - **Blocked By**: T1

  **References**:
  - `src/feishu/client.ts:568` - `sendText`。
  - `src/feishu/client.ts:736` - `sendCard`。
  - `src/feishu/client.ts:481` - card action 处理。

  **Acceptance Criteria**:
  - [ ] Adapter 能完整代理现有发消息/卡片/事件监听能力。
  - [ ] 适配后飞书功能无回归。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Adapter 透传发送（happy path）
    Tool: Bash
    Steps:
      1. 通过 adapter 调用 sendText/sendCard
      2. 检查消息发送成功日志
    Expected Result: 与直接调用 feishuClient 等价
    Evidence: .sisyphus/evidence/task-6-send-through-adapter.txt

  Scenario: 飞书接口异常透传（failure case）
    Tool: Bash
    Steps:
      1. 模拟飞书 API 返回错误
      2. 观察 adapter 返回与日志
    Expected Result: 错误语义与旧行为一致
    Evidence: .sisyphus/evidence/task-6-error-through-adapter.txt
  ```

  **Commit**: YES
  - Message: `refactor(feishu): add feishu platform adapter wrapper`
  - Files: `src/platform/adapters/feishu-adapter.ts`
  - Pre-commit: `npm run build`

- [ ] 7. 入站消息/卡片动作统一经 Router 分发

  **What to do**:
  - 修改 `src/index.ts`：飞书入站先到 Router，再调用既有 handler。
  - 将 `tryHandlePendingPermissionByText` 与 question skip 路径纳入 Router 编排。
  - 确保 `p2p/group/card-action` 入口行为不变。

  **Must NOT do**:
  - 不改变命令解析语义。
  - 不去掉现有错误兜底。

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 多入口改线风险控制。
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T11, T16
  - **Blocked By**: T3, T6

  **References**:
  - `src/index.ts:1003` - message 入站。
  - `src/index.ts:1025` - card action 入站。
  - `src/handlers/p2p.ts:451` - 私聊入口。
  - `src/handlers/group.ts:122` - 群聊入口。

  **Acceptance Criteria**:
  - [ ] 入站全部经过 Router。
  - [ ] legacy/dual 模式下功能结果一致。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 群聊消息分发（happy path）
    Tool: Bash
    Steps:
      1. 启动服务
      2. 发送一条 group 消息事件
      3. 检查 Router 与 groupHandler 日志链
    Expected Result: 进入正确 handler 并触发 OpenCode 调用
    Evidence: .sisyphus/evidence/task-7-group-route.txt

  Scenario: 非法 action payload（failure case）
    Tool: Bash
    Steps:
      1. 发送缺少 action 字段的 card 事件
      2. 检查错误处理
    Expected Result: 返回错误 toast 或安全忽略，不崩溃
    Evidence: .sisyphus/evidence/task-7-invalid-action.txt
  ```

  **Commit**: YES
  - Message: `refactor(router): route inbound message and card actions through root router`
  - Files: `src/index.ts`, `src/router/root-router.ts`
  - Pre-commit: `npm run build`

- [ ] 8. `chat-session` 全链路切换到命名空间键

  **What to do**:
  - 更新调用方：`index/handlers/command/lifecycle` 统一使用 `conversationKey` 或带平台查询。
  - 保留对旧 `chatId` 调用兼容包装函数。
  - 加入会话别名（session alias）在命名空间下的一致性处理。

  **Must NOT do**:
  - 不移除旧接口，先标记 deprecated。

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 跨文件一致性改造。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非浏览器。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T9, T13, T14
  - **Blocked By**: T4

  **References**:
  - `src/store/chat-session.ts:155` - setSession。
  - `src/index.ts:1377` - session error chat 映射。
  - `src/handlers/lifecycle.ts:108` - 清理时 session 获取。

  **Acceptance Criteria**:
  - [ ] 所有核心调用点能处理 namespaced key。
  - [ ] 旧 key 数据可兼容读取。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 命名空间键全链路（happy path）
    Tool: Bash
    Steps:
      1. 创建 `feishu:oc_xxx` 会话绑定
      2. 触发 messagePartUpdated
      3. 断言能正确回路由到该会话
    Expected Result: 输出发送到正确会话 chat
    Evidence: .sisyphus/evidence/task-8-namespaced-flow.txt

  Scenario: 旧 key 调用兼容（failure/edge case）
    Tool: Bash
    Steps:
      1. 仅写入旧 key 数据
      2. 触发 getSession/getChatId
    Expected Result: 返回正确值并记录兼容日志
    Evidence: .sisyphus/evidence/task-8-legacy-compat.txt
  ```

  **Commit**: YES
  - Message: `refactor(store): migrate chat-session call sites to namespaced conversation keys`
  - Files: `src/store/chat-session.ts`, `src/index.ts`, `src/handlers/*.ts`
  - Pre-commit: `npm run build`

- [ ] 9. 抽取 OpenCode 事件分发器（保持单监听）

  **What to do**:
  - 从 `src/index.ts` 抽出 `src/router/opencode-event-hub.ts`。
  - Hub 仅消费一次 `opencodeClient.on(...)` 注册，并按会话平台分发。
  - 不改变权限/问题/流式状态机语义。

  **Must NOT do**:
  - 不新增平台级重复监听器。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 事件中枢解耦设计。
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T10, T16
  - **Blocked By**: T3, T8

  **References**:
  - `src/index.ts:1205` - permissionRequest。
  - `src/index.ts:1385` - messagePartUpdated。
  - `src/index.ts:1611` - questionAsked。
  - `src/opencode/client.ts:523` - 单 SSE 订阅入口。

  **Acceptance Criteria**:
  - [ ] OpenCode listener 注册点总数不增加。
  - [ ] 事件分发逻辑从 index 抽离后行为一致。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 单监听分发（happy path）
    Tool: Bash
    Steps:
      1. 启动服务并统计 opencodeClient.on 注册次数
      2. 触发 permission + messagePart + question 事件
    Expected Result: 各事件被 hub 转发且注册次数不变
    Evidence: .sisyphus/evidence/task-9-single-listener.txt

  Scenario: 无绑定会话事件（failure case）
    Tool: Bash
    Steps:
      1. 发送 session 未绑定事件
      2. 观察处理结果
    Expected Result: 记录 warn，进程稳定
    Evidence: .sisyphus/evidence/task-9-unbound-session.txt
  ```

  **Commit**: YES
  - Message: `refactor(opencode): extract single-listener event hub`
  - Files: `src/router/opencode-event-hub.ts`, `src/index.ts`
  - Pre-commit: `npm run build`

- [ ] 10. 抽象输出发送接口并接入 FeishuSender

  **What to do**:
  - 在输出回调层引入 `PlatformSender` 抽象。
  - 将 `sendText/sendCard/updateCard/deleteMessage` 调用改为 sender 接口。
  - 提供 FeishuSender 实现并保持现有卡片流式策略。

  **Must NOT do**:
  - 不更改 `buildStreamCards` 视觉行为。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`skill-from-masters/docs/skill-from-notebook-design`]
    - `skill-from-masters/docs/skill-from-notebook-design`: 输出层边界隔离。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非必要。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T16
  - **Blocked By**: T6, T9

  **References**:
  - `src/index.ts:861` - outputBuffer update callback。
  - `src/feishu/cards-stream.ts` - 卡片构建与分页预算。
  - `src/opencode/output-buffer.ts:37` - 缓冲区生命周期。

  **Acceptance Criteria**:
  - [ ] 输出回调不再直接依赖 `feishuClient`。
  - [ ] FeishuSender 路径结果与旧行为一致。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 流式输出走 sender（happy path）
    Tool: Bash
    Steps:
      1. 触发 messagePartUpdated 文本增量
      2. 验证 sender.updateCard 被调用
    Expected Result: 卡片正常更新，无丢帧
    Evidence: .sisyphus/evidence/task-10-stream-sender.txt

  Scenario: sender 更新失败降级（failure case）
    Tool: Bash
    Steps:
      1. 模拟 updateCard 失败
      2. 验证补偿发送逻辑
    Expected Result: 重发/降级路径生效，输出不中断
    Evidence: .sisyphus/evidence/task-10-update-fallback.txt
  ```

  **Commit**: YES
  - Message: `refactor(output): decouple output callback via platform sender`
  - Files: `src/index.ts`, `src/platform/senders/feishu-sender.ts`
  - Pre-commit: `npm run build`

- [ ] 11. 建立飞书回归守护测试脚手架（tests-after）

  **What to do**:
  - 引入 `vitest` 与基础配置。
  - 创建回归测试骨架：会话绑定、命令路由、权限/问题状态流。
  - 建立 `.sisyphus/evidence` 输出目录规范脚本。

  **Must NOT do**:
  - 不将测试写成依赖人工点击确认。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 当前先模块级回归，不强制浏览器。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (late)
  - **Blocks**: T16
  - **Blocked By**: T7

  **References**:
  - `package.json:7` - 现有 scripts。
  - `src/handlers/group.ts:122` - 主路由行为。
  - `src/index.ts:1205` - 权限分发行为。

  **Acceptance Criteria**:
  - [ ] `npx vitest run` 可执行。
  - [ ] 至少 3 个飞书回归关键场景被自动验证。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 回归测试可执行（happy path）
    Tool: Bash
    Steps:
      1. 运行 `npx vitest run`
      2. 断言测试执行完成
    Expected Result: 退出码 0
    Evidence: .sisyphus/evidence/task-11-vitest-run.txt

  Scenario: 回归失败阻断（failure case）
    Tool: Bash
    Steps:
      1. 人为注入一个断言失败
      2. 运行测试
    Expected Result: 非 0 退出码且报告失败用例
    Evidence: .sisyphus/evidence/task-11-fail-gate.txt
  ```

  **Commit**: YES
  - Message: `test(regression): add feishu parity guardrail scaffold`
  - Files: `vitest.config.*`, `tests/*`, `package.json`
  - Pre-commit: `npx vitest run`

- [ ] 12. 实现 DiscordAdapter 最小能力（默认关闭）

  **What to do**:
  - 新建 `src/platform/adapters/discord-adapter.ts`。
  - 支持最小文本入站/出站，映射到通用事件与 sender。
  - 通过 `ENABLED_PLATFORMS` 控制默认不启用。

  **Must NOT do**:
  - 不要求首版支持卡片等高级能力。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 非 UI 任务。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T13, T16
  - **Blocked By**: T1, T2

  **References**:
  - `src/platform/adapters/feishu-adapter.ts` - 适配器实现范式。
  - External docs: `https://discord.com/developers/docs/topics/gateway` - 事件接入。

  **Acceptance Criteria**:
  - [ ] Discord 关闭时不影响飞书。
  - [ ] Discord 开启后可完成文本收发闭环。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 默认关闭不影响飞书（happy path）
    Tool: Bash
    Steps:
      1. 不启用 discord 启动服务
      2. 跑飞书回归测试
    Expected Result: 飞书回归全通过
    Evidence: .sisyphus/evidence/task-12-disabled-safe.txt

  Scenario: Discord 配置缺失（failure case）
    Tool: Bash
    Steps:
      1. 启用 discord 但缺少 token
      2. 启动服务
    Expected Result: Discord 子模块报错并降级，不影响 Feishu
    Evidence: .sisyphus/evidence/task-12-missing-token.txt
  ```

  **Commit**: YES
  - Message: `feat(discord): add minimal discord adapter behind feature flag`
  - Files: `src/platform/adapters/discord-adapter.ts`, `src/config.ts`
  - Pre-commit: `npm run build`

- [ ] 13. Discord 会话绑定与路由接线

  **What to do**:
  - 将 Discord conversation 映射接入 `chatSessionStore` 命名空间键。
  - 让 Router 能按 `discord:*` 正确分发入站与出站。
  - 确保 `sessionId -> platform conversation` 反查稳定。

  **Must NOT do**:
  - 不复用 feishu chatId 规则判断。

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非必要。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T16
  - **Blocked By**: T3, T8, T12

  **References**:
  - `src/store/chat-session.ts:118` - session 反查。
  - `src/index.ts:1299` - session 状态映射 chat。
  - `src/index.ts:1377` - session error 映射。

  **Acceptance Criteria**:
  - [ ] Discord 会话可独立绑定且不污染 Feishu。
  - [ ] OpenCode 输出可按平台正确回路由。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Discord 会话独立绑定（happy path）
    Tool: Bash
    Steps:
      1. 创建 `discord:channel_xxx` 绑定到 sessionA
      2. 触发 sessionA 输出事件
    Expected Result: 输出仅发往 Discord 通道
    Evidence: .sisyphus/evidence/task-13-discord-binding.txt

  Scenario: 跨平台 session 冲突（failure case）
    Tool: Bash
    Steps:
      1. 故意将同 session 绑定到 feishu 与 discord
      2. 触发冲突解析
    Expected Result: 告警 + 按策略确定唯一目标
    Evidence: .sisyphus/evidence/task-13-cross-platform-conflict.txt
  ```

  **Commit**: YES
  - Message: `feat(router): wire discord session binding and platform-aware dispatch`
  - Files: `src/store/chat-session.ts`, `src/router/*`
  - Pre-commit: `npm run build`

- [ ] 14. 生命周期清理改为分平台策略

  **What to do**:
  - 重构 `src/handlers/lifecycle.ts`：按平台执行清理策略。
  - Feishu 清理逻辑保持原语义；Discord 增加最小清理策略（仅本地映射）。

  **Must NOT do**:
  - 不把 Feishu 群解散语义套到 Discord。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 无关。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: T16
  - **Blocked By**: T4, T8

  **References**:
  - `src/handlers/lifecycle.ts:25` - 启动清理主流程。
  - `src/handlers/lifecycle.ts:106` - cleanupAndDisband。

  **Acceptance Criteria**:
  - [ ] Feishu 清理行为回归一致。
  - [ ] Discord 不执行 Feishu 专属 API 操作。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Feishu 清理回归（happy path）
    Tool: Bash
    Steps:
      1. 构造可清理 Feishu 群映射
      2. 执行 runCleanupScan
    Expected Result: 统计项与旧逻辑一致
    Evidence: .sisyphus/evidence/task-14-feishu-cleanup.txt

  Scenario: Discord 映射清理边界（failure case）
    Tool: Bash
    Steps:
      1. 构造 discord 映射
      2. 运行清理
    Expected Result: 不触发 Feishu disband API
    Evidence: .sisyphus/evidence/task-14-discord-boundary.txt
  ```

  **Commit**: YES
  - Message: `refactor(lifecycle): introduce platform-specific cleanup strategy`
  - Files: `src/handlers/lifecycle.ts`
  - Pre-commit: `npm run build`

- [ ] 15. 双轨对比日志与回滚开关完善

  **What to do**:
  - 在 `dual` 模式记录旧/新路由决策与差异。
  - 提供一键回滚到 `legacy` 的明确开关路径。
  - 增加结构化日志字段：platform, conversationKey, sessionId, routeDecision。

  **Must NOT do**:
  - 不在日志中泄露敏感信息。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T16 late)
  - **Blocks**: T16
  - **Blocked By**: T5

  **References**:
  - `src/index.ts:1208` - 现有事件日志模式。
  - `src/index.ts:1264` - unresolved 警告风格。

  **Acceptance Criteria**:
  - [ ] dual 模式产生可比对日志。
  - [ ] legacy 回滚只需改 env 并重启。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: dual 对比日志（happy path）
    Tool: Bash
    Steps:
      1. 设置 ROUTER_MODE=dual 启动
      2. 触发一条消息
      3. 检查差异日志输出
    Expected Result: 包含旧路由与新路由决策字段
    Evidence: .sisyphus/evidence/task-15-dual-log.txt

  Scenario: 回滚 legacy（failure recovery）
    Tool: Bash
    Steps:
      1. 设置 ROUTER_MODE=legacy
      2. 重启并复测消息链路
    Expected Result: 新路由分支不再执行
    Evidence: .sisyphus/evidence/task-15-rollback.txt
  ```

  **Commit**: YES
  - Message: `chore(ops): add dual-route parity logging and rollback toggles`
  - Files: `src/index.ts`, `src/router/*`
  - Pre-commit: `npm run build`

- [ ] 16. 端到端联调与灰度验收收口

  **What to do**:
  - 按 `legacy -> dual -> router` 分阶段执行验收。
  - 跑飞书回归 + Discord 首批场景 + OpenCode 单监听一致性检查。
  - 产出灰度发布与回滚 SOP 文档（简版）。

  **Must NOT do**:
  - 不在未完成回归前切 `router` 为默认。

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 无关。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (integration gate)
  - **Blocks**: F1,F2,F3,F4
  - **Blocked By**: T5,T7,T9,T10,T11,T12,T13,T14,T15

  **References**:
  - `src/index.ts` - 总编排行为。
  - `src/opencode/client.ts:524` - 单 SSE 订阅。
  - `README.md` - 运行与运维命令习惯。

  **Acceptance Criteria**:
  - [ ] legacy/dual/router 三模式均有验证证据。
  - [ ] 飞书核心能力零回归。
  - [ ] Discord 首批能力在开关开启时可用。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 三阶段灰度验收（happy path）
    Tool: Bash
    Steps:
      1. MODE=legacy 执行回归
      2. MODE=dual 执行回归并比对日志
      3. MODE=router 执行回归 + discord 场景
    Expected Result: 三阶段全部通过，差异可解释
    Evidence: .sisyphus/evidence/task-16-rollout-gate.txt

  Scenario: router 模式异常回滚（failure case）
    Tool: Bash
    Steps:
      1. 在 router 下触发已知异常场景
      2. 切回 legacy 重启
      3. 复测飞书链路
    Expected Result: 飞书链路恢复稳定
    Evidence: .sisyphus/evidence/task-16-fallback-recovery.txt
  ```

  **Commit**: YES
  - Message: `chore(release): finalize phased rollout verification and fallback SOP`
  - Files: `README.md` (or ops doc), `scripts/*` (if needed)
  - Pre-commit: `npm run build && npx vitest run`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **C1 (Wave1)**: `refactor(core): introduce platform adapter contracts and router scaffolding`
- **C2 (Wave2)**: `refactor(feishu): route ingress and opencode dispatch through platform-aware core`
- **C3 (Wave3)**: `feat(discord): add first platform extension under feature flags`
- **C4 (Verification fixes)**: `chore(qa): add regression tests and rollout guardrails`

---

## Success Criteria

### Verification Commands
```bash
npm run build
npx vitest run
node dist/index.js
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] OpenCode listener remains single registration point
- [ ] Feishu parity regression suite passes
- [ ] Discord can be enabled/disabled by flag without affecting Feishu
