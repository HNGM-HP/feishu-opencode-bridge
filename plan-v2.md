# Plan v2 — Skill / MCP / Agent / Model 资源管理

> 目标：在 opencode-bridge 中新增统一的资源（skill / mcp / agent / model）管理体系，
> 支持 `/` 命令热载、Web 与 TUI 双前端管理，下线飞书的 agent 管理路径。
>
> 落档时间：2026-05-02。本文件随实施同步更新。

## 1. 总体决策（已与用户确认）

| 项 | 决策 |
| --- | --- |
| 资源根目录 | `./data/skills/`、`./data/mcp/`、`./data/agents/`、`./data/providers/` |
| 配置覆盖 | 两层：用户级 `~/.opencode-bridge/<同结构>` + 项目级 `./data/`，项目级优先 |
| Skill 形态 | Claude Code 风格：`<name>/SKILL.md`（YAML frontmatter）+ `scripts/`、`assets/` |
| MCP 存储 | 每 server 一文件 `mcp/<name>.json` + `mcp/_index.json`（启用顺序与全局开关） |
| Provider 管理 | 直接读写 `~/.local/share/opencode/auth.json`（仅 type=api）；OAuth 通过 Web PTY 终端跑 `opencode providers login` |
| Web 入口 | 左侧栏一级菜单"资源管理"，4 个 tab |
| OAuth 登录 | 实现 Web 弹出系统终端（node-pty + xterm.js + WebSocket） |
| 飞书路径 | 完全废弃 agent 管理命令，改提示语 |

## 2. 目录与文件骨架

```
data/
  skills/<name>/
    SKILL.md                 # YAML frontmatter + Markdown
    scripts/...              # 可选
    assets/...               # 可选
  mcp/
    _index.json              # { enabled: string[], order: string[], updatedAt }
    <name>.json              # { name, transport, command, args, env, enabled, description }
  agents/
    <name>.json              # { name, model, systemPrompt, tools, temperature, ... }
  providers/
    overrides.json           # 项目级 provider 覆盖（自定义 baseURL/模型别名）
~/.opencode-bridge/
  skills/ mcp/ agents/ providers/   # 用户级，结构同上，优先级低
```

## 3. 后端模块（`src/services/resources/`）

| 文件 | 职责 |
| --- | --- |
| `paths.ts` | 解析项目级与用户级路径、合并器 |
| `skills/loader.ts` | 扫描 + 解析 SKILL.md、缓存、chokidar 热载 |
| `skills/registry.ts` | CRUD、enable/disable、slash 映射 |
| `mcp/manager.ts` | `<name>.json` + `_index.json` 读写、热载、生成 opencode 合并配置 |
| `mcp/slash.ts` | 把 enabled MCP server 的 prompts 协议映射成 `/mcp:<server>:<prompt>` |
| `agents/manager.ts` | CRUD，与 opencode `agent` 子命令对齐字段 |
| `providers/auth-store.ts` | 读写 `~/.local/share/opencode/auth.json`（保留未知字段） |
| `providers/manager.ts` | 列 provider/model（缓存 `opencode models` 输出）、设/删 API key |
| `events.ts` | 统一事件总线 `resource:changed`（对接 SSE + slash cache 失效） |
| `index.ts` | 资源系统启动器（被 admin-server 引导） |

热载策略：chokidar 监听三类目录（`skills/`、`mcp/`、`agents/`）；变更去抖 200ms → emit `resource:changed` → SSE 广播 → 前端清空 `slash-command-cache` + 拉新列表。

## 4. REST API（挂在 `src/admin/routes/resources.ts`）

```
GET    /api/resources/skills                列表（含 status/lastReload/error）
POST   /api/resources/skills                新建 { name, content, scope: project|user }
GET    /api/resources/skills/:name          { raw, frontmatter, body, scope, status }
PUT    /api/resources/skills/:name          { content }
DELETE /api/resources/skills/:name
POST   /api/resources/skills/:name/toggle   { enabled }

GET/POST/PUT/DELETE /api/resources/mcp[/:name]
POST   /api/resources/mcp/:name/toggle

GET/POST/PUT/DELETE /api/resources/agents[/:name]

GET    /api/resources/providers             { id, type, configured, models? }
PUT    /api/resources/providers/:id         { apiKey }      # 仅 type=api
DELETE /api/resources/providers/:id
GET    /api/resources/providers/:id/models
POST   /api/resources/providers/refresh     # 触发 opencode models 缓存刷新

GET    /api/resources/events                # SSE 资源变更事件流

# OAuth Web 终端
WS     /api/resources/terminal              # node-pty 双向流，命令限定白名单
```

## 5. Slash 命令打通

修改 `src/admin/routes/chat-meta.ts` 的 `/api/chat/commands`：
1. 调 `opencodeClient.getCommands()`（保留）
2. 合并我们的：`/{skill}`（每个 enabled skill 一条）、`/mcp` 总览、`/mcp:<server>:<prompt>`、`/agent:<name>`
3. 排序、按组（command/mcp/skill/agent/other）返回

前端 `web/src/views/chat/slash-command-cache.ts`：订阅资源 SSE，收到 `resource:changed` 时 `commandCache = null`。

## 6. Web 前端

```
web/src/
  views/resources/
    ResourcesView.vue          # 容器，4 tab
    skills/SkillsTab.vue + SkillEditor.vue
    mcp/McpTab.vue       + McpEditor.vue
    agents/AgentsTab.vue + AgentEditor.vue
    providers/ProvidersTab.vue + ProviderEditor.vue + OAuthTerminal.vue
  components/resources/
    ResourceStatusBadge.vue    # 通用状态徽标
    ScopeSwitch.vue            # 项目级/用户级
  api/resources.ts             # REST + SSE 客户端
  stores/resources.ts          # Pinia store，订阅 SSE
```

路由：`/resources` → 默认重定向到 `/resources/skills`；侧边栏"资源管理"一级菜单。

编辑器：Monaco（已有依赖）；Skill 编辑器走 markdown 模式 + frontmatter 校验；MCP/Agent 走 JSON Schema 表单 + raw 切换；Provider OAuth 启动 xterm.js 连 WebSocket。

## 7. TUI 命令（`src/cli/`）

```
bridge resource skill   list | create <name> | edit <name> | enable/disable <name> | delete <name>
bridge resource mcp     list | add <name> | edit <name> | enable/disable <name> | delete <name>
bridge resource agent   list | create <name> | edit <name> | delete <name>
bridge resource model   providers | set-key <id> <key> | remove-key <id> | models [provider] | login [provider]
```

## 8. 飞书路径迁移

- `src/handlers/command.ts`：agent 创建/管理命令改返回提示"已下线"
- `src/feishu/cards.ts`：移除 agent 创建相关卡片定义
- 启动迁移：若 `data/agents/` 为空且 `~/.config/opencode/agents/` 有内容，一次性导入

## 9. 测试

- `tests/services/resources/skills.test.ts`：frontmatter、热载、覆盖优先级
- `tests/services/resources/mcp.test.ts`：索引一致性、读写并发
- `tests/services/resources/providers.test.ts`：auth.json 读写不破坏未知字段
- `tests/router/resources.test.ts`：REST 端到端

## 10. 落地顺序（每步独立可验证）

1. data/ 骨架 + 两层路径解析
2. Skill loader + registry + 单元测试
3. MCP manager + 热载
4. Agent manager
5. Provider manager（auth.json 读写 + models 缓存）
6. 资源 REST 路由聚合 + SSE
7. OAuth Web PTY 终端
8. 打通 `/api/chat/commands`（修复 `/mcp` 缺失）
9. Web 资源管理页 + 4 tab + 状态徽标
10. TUI 子命令
11. 飞书 agent 路径下线
12. 测试 + README 更新

## 11. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 热载抖动导致 slash 列表抖动 | chokidar 去抖 200ms + 前端 SSE 200ms 节流 |
| 写 auth.json 破坏 oauth 字段 | 读后整体回写，仅替换目标 key，保留未知字段 |
| Web PTY 安全 | 命令白名单（仅 `opencode providers login/logout/list`）、单连接超时 10 分钟 |
| 飞书用户在迁移期失去入口 | 命令改提示而非删除，README 同步说明 |
