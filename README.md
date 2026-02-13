# Feishu x OpenCode Bridge ✨🤖✨

[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

把本地 OpenCode 直接接进飞书，不只是“能聊”，而是把权限确认、question 答题、流式卡片、会话绑定隔离、`/undo` 双端回滚与运维部署做成完整闭环。

## 🎯 先看痛点

- 只做消息转发不够：OpenCode 在真实任务中会发起权限请求、追问问题，很多桥接方案在这里断链。
- 交互断链会直接影响可用性：权限无法确认、题目无法作答，任务会卡住或只能回到本地控制台。
- 会话与撤回容易错位：如果没有稳定的 `chat <-> session` 映射和一致回滚，群聊多轮很容易串上下文。
- 部署可维护性常被忽略：缺少后台运行、日志与清理策略，导致“能跑一次”但不适合长期使用。

这个项目聚焦工程落地：在飞书里尽量完整承接 OpenCode 的关键交互链路，减少切换上下文和人工兜底。

## 🥊 与 OpenClaw 和同类桥接对比

> 结论：如果你只需要基础消息转发，很多方案都能用；如果你需要权限交互、答题交互、回滚一致性和运维闭环，本项目更偏生产实用。

| 维度 | 常见桥接方案（含部分通用方案） | 本项目 |
|---|---|---|
| 权限请求（`permission.asked`） | 常见为日志输出或缺少飞书侧确认 | 飞书权限确认卡，支持一次允许/始终允许/拒绝并回传 |
| AI 提问（`question.asked`） | 常见缺少飞书侧答题闭环 | 提问卡 + 文本作答 + 跳过，自动回传 OpenCode |
| 撤回一致性 | 常见仅单端撤回 | `/undo` 同步回滚 OpenCode 与飞书消息 |
| 会话管理 | 绑定策略较轻，复杂场景易串线 | `chat <-> session` 持久映射，支持清理与恢复 |
| 运维落地 | 偏 Demo 脚本 | 提供启动/停止/部署脚本、systemd 与日志 |
| 附件能力 | 常见不完整 | 支持图片/文件转 OpenCode file part |

注：同类项目实现差异较大，上表描述的是常见缺口，不是绝对判断。

新时代了，让 AI 代理自动部署吧：请在 OpenCode 执行如下指令：
```bash
请阅读 https://github.com/HNGM-HP/feishu-opencode-bridge/blob/main/AI_Deployment_Guide.md 文档并安装程序
```

## 📋 目录

- [先看痛点](#先看痛点)
- [与 OpenClaw 和同类桥接对比](#与-openclaw-和同类桥接对比)
- [为什么用它](#为什么用它)
- [能力总览](#能力总览)
- [效果演示](#效果演示)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [部署与运维](#部署与运维)
- [环境变量](#环境变量)
- [飞书后台配置](#飞书后台配置)
- [命令速查](#命令速查)
- [关键实现细节](#关键实现细节)
- [故障排查](#故障排查)

<a id="为什么用它"></a>
## 💡为什么用它

- 💖 不从“零”开始：不需要你再次配置、构建新的项目，不增加学习成本，不增加设备成本。
- 💬 飞书侧统一入口：群里直接对话，不用切到 OpenCode WebUI。
- 👥 多轮上下文可持续：群聊和 OpenCode session 持久绑定，重启后可继续。
- 📋 交互闭环：AI 要权限、要提问时，全部走飞书卡片，不丢上下文。
- 🐳 对生产友好：提供 Node 脚本 + Linux systemd 菜单化部署方式。

<a id="能力总览"></a>
## 📸 能力总览

| 能力 | 说明 |
|---|---|
| 群聊对话 | 无需@直接可与机器人对话，自动转发到 OpenCode 会话 |
| 私聊会话 | 私聊可直接对话；首次自动建会话并推送建群卡片、`/help`、`/panel`；支持 `/create_chat` 或 `/建群` 一键建群 |
| 会话隔离 | 不管是私聊还是群聊，每个会话自动隔离，opencode自动创建绑定session；可新建多群 |
| 会话清理 | 离群自动解散群聊，opencode自动清理群对应的session会话 |
| Agent 角色 | 支持内置与自定义角色；可在当前群通过 `/panel` 或 `/agent` 自由切换 |
| 模型切换 | 可在当前群通过 `/panel` 或 `/model` 自由切换 |
| 流式输出 | 输出缓冲定时刷新；检测到 thinking/reasoning 自动切卡片 |
| 思考折叠 | 支持展开/折叠思考内容，避免长卡片刷屏 |
| 权限确认 | `permission.asked` 自动发确认卡，支持一次/始终/拒绝 |
| AI 提问 | `question.asked` 生成问答卡，支持单选/多选/自定义/跳过 |
| 一致撤回 | `/undo` 同时回滚 OpenCode 和飞书消息，问答场景支持递归回滚 |
| 附件转发 | 支持飞书图片/文件，下载后按 OpenCode file part 发送 |

<a id="效果演示"></a>
## 🖼️ 效果演示

折叠展示图片，下面按场景整理：

<details>
<summary>Step 1：私聊独立会话（点击展开）</summary>

<p>
  <img src="assets/demo/1-1私聊独立会话.png" width="720" />
  <img src="assets/demo/1-2私聊独立会话.png" width="720" />
  <img src="assets/demo/1-3私聊独立会话.png" width="720" />
  <img src="assets/demo/1-4私聊独立会话.png" width="720" />
</p>

</details>

<details>
<summary>Step 2：多群聊独立会话（点击展开）</summary>

<p>
  <img src="assets/demo/2-1多群聊独立会话.png" width="720" />
  <img src="assets/demo/2-2多群聊独立会话.png.png" width="720" />
  <img src="assets/demo/2-3多群聊独立会话.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 3：图片附件解析（点击展开）</summary>

<p>
  <img src="assets/demo/3-1图片附件解析.png" width="720" />
  <img src="assets/demo/3-2图片附件解析.png.png" width="720" />
  <img src="assets/demo/3-3图片附件解析.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 4：交互工具测试（点击展开）</summary>

<p>
  <img src="assets/demo/4-1交互工具测试.png" width="720" />
  <img src="assets/demo/4-2交互工具测试.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 5：底层权限测试（点击展开）</summary>

<p>
  <img src="assets/demo/5-1底层权限测试.png" width="720" />
  <img src="assets/demo/5-2底层权限测试.png.png" width="720" />
  <img src="assets/demo/5-3底层权限测试.png.png" width="720" />
  <img src="assets/demo/5-4底层权限测试.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 6：会话清理（点击展开）</summary>

<p>
  <img src="assets/demo/6-1会话清理.png" width="720" />
  <img src="assets/demo/6-2会话清理.png.png" width="720" />
  <img src="assets/demo/6-3会话清理.png.png" width="720" />
</p>

</details>

## 📌 架构概览

```mermaid
flowchart LR
  U[飞书用户] --> F[飞书群聊/私聊]
  F --> B[桥接服务]
  B --> O[OpenCode Server]
  O --> B
  B --> C[飞书卡片与消息更新]
  B <--> S[.chat-sessions.json]
```

关键点：

- `sessionId -> chatId` 映射用于权限/提问回路由。
- 输出缓冲层负责节流更新，避免高频 patch 触发限制。
- 文本与卡片属于两种消息类型，必要时会删旧消息并重发卡片。

## 🚀 快速开始

### 1) 前置要求

- Node.js >= 20
- 本机可运行 OpenCode（支持 `opencode serve`）
- 飞书开放平台应用（机器人 + 事件订阅 + 对应权限）

### 2) 启动 OpenCode

```bash
opencode serve --port 4096
```
- 新版本带参数启动opencode 不再显示CLI界面，如果你希望同时展示，请参考下方方法；

- 推荐：OpenCode 裸启动同时启动CLI界面：在 OpenCode 配置文件 `opencode.json` 的根对象中添加/合并 `server` 字段：

```json
"server": {
  "port": 4096,
  "hostname": "0.0.0.0",
  "cors": [
    "*"
  ]
}
```

配置后可直接运行（不用带 `serve --port` 参数）：

```bash
opencode
```

如果由 AI 代理执行部署，建议先询问用户是否需要写入这段配置，再进行修改。

### 3) 配置环境变量

```bash
cp .env.example .env
```

至少填写：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

### 4) 启动桥接服务（开发模式）

```bash
npm install
npm run dev
```

## 💻 部署与运维

### npm 命令

| 目标 | 命令 | 说明 |
|---|---|---|
| 一键部署 | `npm run deploy:bridge` | 安装依赖并编译 |
| 管理菜单 | `npm run manage:bridge` | 交互式菜单（默认入口） |
| 启动后台 | `npm run start:bridge` | 后台启动（自动检测/补构建） |
| 停止后台 | `npm run stop:bridge` | 按 PID 停止后台进程 |

### 跨平台脚本入口

| 平台 | 管理菜单 | 启动 | 停止 |
|---|---|---|---|
| Linux/macOS | `./scripts/deploy.sh menu` | `./scripts/start.sh` | `./scripts/stop.sh` |
| Windows CMD | `scripts\\deploy.cmd menu` | `scripts\\start.cmd` | `scripts\\stop.cmd` |
| PowerShell | `.\\scripts\\deploy.ps1 menu` | `.\\scripts\\start.ps1` | `.\\scripts\\stop.ps1` |

### Linux 常驻（systemd）

管理菜单内提供以下操作：

- 安装并启动 systemd 服务
- 停止并禁用 systemd 服务
- 卸载 systemd 服务
- 查看运行状态

也可以直接命令行调用：

```bash
sudo node scripts/deploy.mjs service-install
sudo node scripts/deploy.mjs service-disable
sudo node scripts/deploy.mjs service-uninstall
node scripts/deploy.mjs status
```

日志默认在 `logs/service.log` 和 `logs/service.err`。

## ⚙️ 环境变量

以 `src/config.ts` 实际读取为准：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `FEISHU_APP_ID` | 是 | - | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是 | - | 飞书应用 App Secret |
| `OPENCODE_HOST` | 否 | `localhost` | OpenCode 地址 |
| `OPENCODE_PORT` | 否 | `4096` | OpenCode 端口 |
| `ALLOWED_USERS` | 否 | - | 飞书 open_id 白名单，逗号分隔；为空时不启用白名单 |
| `DEFAULT_PROVIDER` | 否 | - | 默认模型提供商;与 `DEFAULT_MODEL` 同时配置才生效 |
| `DEFAULT_MODEL` | 否 | - | 默认模型;未配置时跟随 OpenCode 自身默认模型 |
| `TOOL_WHITELIST` | 否 | `Read,Glob,Grep,Task` | 自动放行权限标识列表 |
| `OUTPUT_UPDATE_INTERVAL` | 否 | `3000` | 输出刷新间隔（ms） |
| `ATTACHMENT_MAX_SIZE` | 否 | `52428800` | 附件大小上限（字节） |

注意：`TOOL_WHITELIST` 做字符串匹配，权限事件可能使用 `permission` 字段值（例如 `external_directory`），请按实际标识配置。

模型默认策略:仅当 `DEFAULT_PROVIDER` 与 `DEFAULT_MODEL` 同时配置时，桥接才会显式指定模型;否则由 OpenCode 自身默认模型决定。

`ALLOWED_USERS` 说明：

- 未配置或留空：不启用白名单；生命周期清理仅在群成员数为 `0` 时才会自动解散群聊。
- 已配置：启用白名单保护；当群成员不足且群内/群主都不在白名单时，才会自动解散。

## ⚙️ 飞书后台配置

建议使用长连接模式（WebSocket 事件）。

### 事件订阅（按代码已注册项）

| 事件 | 必需 | 用途 |
|---|---|---|
| `im.message.receive_v1` | 是 | 接收群聊/私聊消息 |
| `im.message.recalled_v1` | 是 | 用户撤回触发 `/undo` 回滚 |
| `im.chat.member.user.deleted_v1` | 是 | 成员退群后触发生命周期清理 |
| `im.chat.disbanded_v1` | 是 | 群解散后清理本地会话映射 |
| `card.action.trigger` | 是 | 处理控制面板、权限确认、提问卡片回调 |
| `im.message.message_read_v1` | 否 | 已读回执兼容（可不开启） |

### 应用权限（按实际调用接口梳理）

| 能力分组 | 代码中调用的接口 | 用途 |
|---|---|---|
| 消息读写与撤回（`im:message`） | `im:message.p2p_msg:readonly` / `im:message.group_at_msg:readonly` / `im:message.group_msg` / `im:message.reactions:read` / `im:message.reactions:write_only` | 发送文本/卡片、流式更新卡片、撤回消息 |
| 群与成员管理（`im:chat`） | `im:chat.members:read` / `im:chat.members:write_only` | 私聊建群、拉人进群、查群成员、自动清理无效群 |
| 消息资源下载（`im:resource`） | `im.messageResource.get` | 下载图片/文件附件并转发给 OpenCode |

注意：飞书后台不同版本的权限名称可能略有差异，按上表接口能力逐项对齐即可；若只需文本对话且不处理附件，可暂不开启 `im:resource`。
- 可以复制下方参数保存至acc.json，然后在飞书`开发者后台`--`权限管理`--`批量导入/导出权限`
```json
{
  "scopes": {
    "tenant": [
      "im:message.p2p_msg:readonly",
      "im:chat",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:resource"
    ],
    "user": []
  }
}
```

## 📖 命令速查

| 命令 | 说明 |
|---|---|
| `/help` | 查看帮助 |
| `/panel` | 打开控制面板（模型、Agent、停止、撤回） |
| `/model` | 查看当前模型 |
| `/model <provider:model>` | 切换模型（支持 `provider/model`） |
| `/agent` | 查看当前 Agent |
| `/agent <name>` | 切换 Agent |
| `/agent off` | 关闭 Agent，回到默认 |
| `/role create <规格>` | 斜杠形式创建自定义角色 |
| `创建角色 名称=...; 描述=...; 类型=...; 工具=...` | 自然语言创建自定义角色并切换 |
| `/stop` | 中断当前会话执行 |
| `/undo` | 撤回上一轮交互（OpenCode + 飞书同步） |
| `/session new` | 新建会话并重置上下文 |
| `新建会话窗口` | 自然语言触发新建会话（等价 `/session new`） |
| `/clear` | 等价于 `/session new` |
| `/clear free session` | 清理空闲群聊和会话 |
| `/compact` | 透传到 OpenCode，压缩当前会话上下文 |
| `/create_chat` / `/建群` | 私聊中直接创建新会话群（等价建群卡片按钮） |
| `/status` | 查看当前群绑定状态 |

## 🤖 Agent（角色）使用

### 1) 查看与切换

- 推荐使用 `/panel` 可视化切换角色（当前群即时生效）。
- 也可用命令：`/agent`（查看当前）、`/agent <name>`（切换）、`/agent off`（回到默认）。

### 2) 自定义 Agent

- 支持自然语言直接创建并切换：

```text
创建角色 名称=旅行助手; 描述=擅长制定旅行计划; 类型=主; 工具=webfetch; 提示词=先询问预算和时间，再给三套方案
```

- 也支持斜杠形式：

```text
/role create 名称=代码审查员; 描述=关注可维护性和安全; 类型=子; 工具=read,grep; 提示词=先列风险，再给最小改动建议
```

- `类型` 支持 `主/子`（或 `primary/subagent`）。

### 3) 配置默认 Agent（提醒）

- 可在 OpenCode 配置文件 `opencode.json` 设置 `default_agent`。
- 当桥接侧未显式指定角色时，会跟随 OpenCode 的默认 Agent。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "companion"
}
```

- 修改后如果 `/panel` 未立即显示新角色，重启 OpenCode 即可。

## 📌 关键实现细节

### 1) 权限请求回传

- `permission.asked` 里 `tool` 可能不是字符串工具名，实际白名单匹配可落在 `permission` 字段。
- 回传接口要求 `response` 为 `once | always | reject`，不是 `allow | deny`。

### 2) question 工具交互

- 问题渲染为飞书卡片，答案通过用户文字回复解析。
- 解析后按 OpenCode 需要的 `answers: string[][]` 回传，并纳入撤回历史。

### 3) 流式与思考卡片

- 文本与思考分流写入输出缓冲；出现思考内容时自动切换卡片模式。
- 卡片支持展开/折叠思考，最终态保留完成状态。

### 4) `/undo` 一致性

- 需要同时删除飞书侧消息并对 OpenCode 执行 `revert`。
- 问答场景可能涉及多条关联消息，使用递归回滚兜底。

## 🛠️ 故障排查

| 现象 | 优先检查 |
|---|---|
| 飞书发送消息后OpenCode无反应 | 仔细检查飞书权限；确认 ⚙️ 飞书后台配置 正确 |
| 点权限卡片后 OpenCode 无反应 | 日志是否出现权限回传失败；确认回传值是 `once/always/reject` |
| 权限卡或提问卡发不到群 | `.chat-sessions.json` 中 `sessionId -> chatId` 映射是否存在 |
| 卡片更新失败 | 消息类型是否匹配；失败后是否降级为重发卡片 |
| 后台模式无法停止 | `logs/bridge.pid` 是否残留；使用 `npm run stop:bridge` 清理 |
| 私聊首次会推送多条引导消息 | 这是首次流程（建群卡片 + `/help` + `/panel`）；后续会按已绑定会话正常对话 |
## 📝 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)

**GPL v3 意味着：**
- ✅ 可自由使用、修改和分发
- ✅ 可用于商业目的
- 📝 必须开源修改版本
- 📝 必须保留原作者版权
- 📝 衍生作品必须使用 GPL v3 协议

如果这个项目对你有帮助，请给个 ⭐️ Star！
