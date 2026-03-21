# Feishu / Discord × OpenCode 桥接服务 v2.9.3-beta

[![v2.9.3-beta](https://img.shields.io/badge/v2.9.3--beta-3178C6)]()
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[中文](README.md)** | **[English](README-en.md)**

---

不只服务飞书，也服务 Discord。通过"平台适配层 + 根路由器 + OpenCode 事件中枢 + 领域处理器"，重点解决跨平台扩展、权限闭环稳定性、目录实例一致性和线上可维护性。

**v2.9.3-beta 新增 Web 可视化配置中心**：配置参数由 `.env` 迁移至 SQLite 数据库，支持通过浏览器实时修改配置、管理 Cron 任务、查看服务状态，无需手动编辑配置文件。

随着运行时 Cron（API + `/cron` + `///cron` + 自然语言语义解析）与本地可靠性治理落地，本项目和 OpenClaw 在"自动化调度 + 运维可用性"上的能力差距进一步缩小，同时保留本项目在多平台路由与权限闭环上的工程优势。

这个项目解决的不是"能不能回复消息"，而是"跨平台 AI 任务能否长期稳定闭环"。
## 📋 目录

- [为什么用它](#为什么用它)
- [能力总览](#能力总览)
- [效果演示](#效果演示)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [部署与运维](#部署与运维)
- [配置中心](#配置中心)
- [可靠性能力](#可靠性能力)
- [飞书后台配置](#飞书后台配置)
- [命令速查](#命令速查)
- [Agent 使用](#agent使用)
- [详细文档](#详细文档)

<a id="为什么用它"></a>
## 💡为什么用它

- 对使用者友好：权限确认、question 作答、会话操作都在飞书里完成，不强依赖本地终端。
- 对协作友好：支持绑定已有会话与迁移绑定，跨设备、跨群接力时上下文不断裂。
- 对稳定性友好：会话映射持久化 + 双端撤回 + 同规则清理，避免"表面正常、状态错位"。
- 对运维友好：内置部署、升级、状态检查与后台管理流程，适合持续托管运行。
- 对监控友好：内置cron定时任务与主动心跳，可以做到像OpenClaw类似的能力。
- 对未来版本友好：已兼容 OpenCode Server Basic Auth，服务端启用密码后仍可直接接入。

<a id="能力总览"></a>
## 📸 能力总览

| 能力 | 你能得到什么 | 相关命令/配置 |
|---|---|---|
| 群聊/私聊统一路由 | 同一套入口支持私聊和群聊，按映射路由到正确会话 | 群聊 @ 机器人；私聊直接发消息 |
| 私聊建群会话选择 | 建群时可选"新建会话/绑定已有会话"，提交时按选择生效 | `/create_chat`、`/建群` |
| 手动会话绑定 | 不中断旧上下文，直接把指定 session 接入当前群 | `/session <sessionId>`、`路由模式与会话ENABLE_MANUAL_SESSION_BIND` |
| 迁移绑定与删除保护 | 绑定已有会话时自动迁移旧群映射，并保护会话不被误删 | 自动生效（手动绑定场景） |
| 生命周期清理兜底 | 启动清理与手动清理共用同一规则，降低误清理概率 | `/clear free session` |
| 权限卡片闭环 | OpenCode 权限请求在飞书内完成确认并回传结果 | `permission.asked` |
| question 卡片闭环 | OpenCode question 在飞书内回答/跳过并继续任务 | `question.asked` |
| 流式多卡防溢出 | 超过组件预算自动分页拆卡，旧页持续更新 | 流式卡片分页（预算 180） |
| 双端撤回一致性 | 撤回时同时回滚飞书消息与 OpenCode 会话状态 | `/undo` |
| 模型/角色/强度可视化控制 | 按会话切换模型、角色与推理强度，支持面板查看与命令操作 | `/panel`、`/model`、`/agent`、`/effort` |
| 上下文压缩 | 在飞书直接触发会话 summarize，释放上下文窗口 | `/compact` |
| Shell 命令透传 | 白名单 `!` 命令通过 OpenCode shell 执行并回显输出 | `!ls`、`!pwd`、`!git status` |
| 服务端鉴权兼容 | 支持 OpenCode Server Basic Auth，不怕后续默认强制密码 | `WEB-OpenCode 对接配置-Basic Auth 认证` |
| 文件发送到飞书 | AI 可将电脑上的文件/截图直接发送到当前飞书群聊 | `/send`、`发送文件` |
| 工作目录/项目管理 | 创建会话时指定工作目录，支持项目别名、群默认项目、9 阶段安全校验 | `/project list`、`/session new <别名>`、`ALLOWED_DIRECTORIES` |
| OpenCode 本地可靠性治理 | 运行时 Cron（API/命令/自然语言）+ 本地宕机自动救援（含配置备份/两级回退）+ 可选主动心跳 | `HEARTBEAT.md`、`RELIABILITY_*`、`logs/reliability-audit.jsonl` |
| 部署运维闭环 | 提供部署/升级/检查/后台/systemd 的一体化入口 | `scripts/deploy.*`、`scripts/start.*` |
| Web 可视化配置中心 | 浏览器访问配置面板，实时修改参数、管理 Cron 任务、查看服务状态，配置存储于 SQLite | `ADMIN_PORT`、`ADMIN_PASSWORD`、访问 `http://host:4098` |

<a id="效果演示"></a>
## 🖼️ 效果演示

<details>
<summary>Step 1：WEB可视化界面（点击展开）</summary>

<p>
  <img src="assets/demo/web1.png" width="720" />
  <img src="assets/demo/web2.png" width="720" />
  <img src="assets/demo/web3.png" width="720" />
  <img src="assets/demo/web4.png" width="720" />
  <img src="assets/demo/web5.png" width="720" />
  <img src="assets/demo/web6.png" width="720" />
  <img src="assets/demo/web7.png" width="720" />
  <img src="assets/demo/web8.png" width="720" />
</p>

</details>

<details>
<summary>Step 2：私聊独立会话（点击展开）</summary>

<p>
  <img src="assets/demo/1-1私聊独立会话.png" width="720" />
  <img src="assets/demo/1-2私聊独立会话.png" width="720" />
  <img src="assets/demo/1-3私聊独立会话.png" width="720" />
  <img src="assets/demo/1-4私聊独立会话.png" width="720" />
</p>

</details>

<details>
<summary>Step 3：多群聊独立会话（点击展开）</summary>

<p>
  <img src="assets/demo/2-1多群聊独立会话.png" width="720" />
  <img src="assets/demo/2-2多群聊独立会话.png.png" width="720" />
  <img src="assets/demo/2-3多群聊独立会话.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 4：图片附件解析（点击展开）</summary>

<p>
  <img src="assets/demo/3-1图片附件解析.png" width="720" />
  <img src="assets/demo/3-2图片附件解析.png.png" width="720" />
  <img src="assets/demo/3-3图片附件解析.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 5：交互工具测试（点击展开）</summary>

<p>
  <img src="assets/demo/4-1交互工具测试.png" width="720" />
  <img src="assets/demo/4-2交互工具测试.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 6：底层权限测试（点击展开）</summary>

<p>
  <img src="assets/demo/5-1底层权限测试.png" width="720" />
  <img src="assets/demo/5-2底层权限测试.png.png" width="720" />
  <img src="assets/demo/5-3底层权限测试.png.png" width="720" />
  <img src="assets/demo/5-4底层权限测试.png.png" width="720" />
</p>

</details>

<details>
<summary>Step 7：会话清理（点击展开）</summary>

<p>
  <img src="assets/demo/6-1会话清理.png" width="720" />
  <img src="assets/demo/6-2会话清理.png.png" width="720" />
  <img src="assets/demo/6-3会话清理.png.png" width="720" />
</p>

</details>

<a id="架构概览"></a>
## 📌 架构概览

详见 [项目架构文档](assets/docs/architecture.md)。

核心分层：
- **平台接入层**：Feishu Adapter / Discord Adapter
- **入口与路由层**：RootRouter / DiscordHandler
- **领域服务层**：PermissionHandler / QuestionHandler / OutputBuffer / ChatSessionStore
- **OpenCode 集成层**：OpencodeClientWrapper / OpenCodeEventHub

<a id="快速开始"></a>
## 🚀 快速开始

### 1) 先执行这一条命令（首选）

Linux/macOS：

```bash
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
chmod +x ./scripts/deploy.sh
./scripts/deploy.sh guide
```

Windows PowerShell：

```powershell
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
.\scripts\deploy.ps1 guide
```

这条命令会自动完成：
- 检测 Node.js / npm（缺失时给安装引导）
- 检测 OpenCode 安装与端口状态
- 可一键安装 OpenCode（`npm i -g opencode-ai`）
- 安装项目依赖并编译桥接服务
- 若 `.env` 不存在，会自动生成包含 `ADMIN_PORT` 和 `ADMIN_PASSWORD` 的配置文件

**提醒**：
- 不添加 `guide` 后缀执行命令为菜单。
- 这一条命令可以完成"部署与环境准备"。
- 启动服务后，通过浏览器访问 `http://localhost:4098` 进入可视化配置面板填写飞书配置。

### 2) Web 配置面板

服务启动后，打开浏览器访问：
```
http://localhost:4098
```

在 Web 配置面板中完成：
- 飞书应用配置（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`）
- OpenCode 连接配置
- Discord 适配器配置
- 可靠性参数配置
- Cron 任务管理
- 服务状态查看

**首次访问**：密码在 `.env` 文件的 `ADMIN_PASSWORD` 字段，首次启动时会自动生成随机密码。


### 3) 启动 OpenCode（保留 CLI 界面）

```bash
opencode
```

### 4) 启动桥接服务

Linux/macOS：

```bash
./scripts/start.sh
```

Windows PowerShell：

```powershell
.\scripts\start.ps1
```

开发调试可用：

```bash
npm run dev
```

启动后访问 `http://localhost:4098` 进入 Web 配置面板。

### 5）npm CLI 安装（更适合本地常驻运行场景）

```bash
npm install -g opencode-bridge
opencode-bridge
```

配置的详细说明见 [部署与运维文档](assets/docs/deployment.md)。

<a id="部署与运维"></a>
## 💻 部署与运维

### 已安装 Node 后可用命令

| 目标 | 命令 | 说明 |
|---|---|---|
| 一键部署 | `node scripts/deploy.mjs deploy` | 默认清洁安装后再安装依赖并编译 |
| 启动后台 | `npm run start` | 后台启动（自动检测/补构建） |
| 停止后台 | `node scripts/stop.mjs` | 按 PID 停止后台进程 |
| 首次引导 | `node scripts/deploy.mjs guide` | 安装/部署/引导启动的一体化流程 |
| 管理菜单 | `npm run manage:bridge` | 交互式菜单（默认入口） |


详细部署说明见 [部署与运维文档](assets/docs/deployment.md)。

<a id="配置中心"></a>
## ⚙️ 配置中心

### Web 配置面板（推荐）

服务启动后，访问 `http://localhost:4098` 可视化配置面板：

- **实时配置**：修改参数后立即生效（部分敏感配置需重启）
- **Cron 管理**：创建、启用/禁用、删除定时任务
- **服务状态**：查看运行时长、版本、数据库路径等
- **模型列表**：获取 OpenCode 可用的模型列表

### .env 文件（仅启动参数）

`.env` 文件现在仅用于存储 Admin 面板的启动参数：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `ADMIN_PORT` | 否 | `4098` | Web 配置面板监听端口 |
| `ADMIN_PASSWORD` | 否 | 自动生成 | Web 配置面板访问密码 |

**注意**：`.env` 不再作为业务配置文件使用，业务配置存储于 SQLite 数据库。

### 核心业务配置

以下配置通过 Web 面板或 SQLite 数据库管理：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `飞书应用 App ID` | 是 | - | WEB-平台接入-飞书（Lark）配置 |
| `飞书应用 App Secret` | 是 | - | WEB-平台接入-飞书（Lark）配置 |
| `是否启用 Discord 适配器` | 否 | `false` | WEB-平台接入-Discord 配置 |
| `Discord Bot Token` | 否 | - | WEB-平台接入-Discord 配置 |

完整配置详见 [配置中心文档](assets/docs/environment.md)。

### 配置存储说明

**配置迁移**：老用户，系统会自动将 `.env` 中的业务配置迁移至 SQLite 数据库（`data/config.db`），原 `.env` 备份为 `.env.backup`。
- 新用户部署完成后直接打开web使用即可
**敏感配置重启**：以下配置修改后需要重启服务才能生效：
- 飞书配置（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`）
- Discord 配置（`DISCORD_ENABLED`、`DISCORD_TOKEN`）
- OpenCode 连接配置（`OPENCODE_HOST`、`OPENCODE_PORT`）
- 可靠性开关（`RELIABILITY_CRON_ENABLED` 等）

<a id="可靠性能力"></a>
## 🛡️ 可靠性能力（心跳 + Cron + 宕机救援）

详见 [可靠性指南](assets/docs/reliability.md)。

### 快速概览

- **内置 Cron 任务**：`watchdog-probe`（30 秒）、`process-consistency-check`（60 秒）、`budget-reset`（每天 0 点）
- **三种管理入口**：HTTP API（`/cron/*`）、Feishu（`/cron ...`）、Discord（`///cron ...`）
- **主动心跳**：可配置定时器向 Agent Session 发送检查提示
- **自动救援**：连续失败达到阈值后自动修复本地 OpenCode（仅 loopback）


<a id="飞书后台配置"></a>
## ⚙️ 飞书后台配置

详见 [飞书后台配置文档](assets/docs/feishu-config.md)。

### 事件订阅

| 事件 | 必需 | 用途 |
|---|---|---|
| `im.message.receive_v1` | 是 | 接收群聊/私聊消息 |
| `im.message.recalled_v1` | 是 | 用户撤回触发 `/undo` 回滚 |
| `im.chat.member.user.deleted_v1` | 是 | 成员退群后触发生命周期清理 |
| `im.chat.disbanded_v1` | 是 | 群解散后清理本地会话映射 |
| `card.action.trigger` | 是 | 处理控制面板、权限确认、提问卡片回调 |

### 应用权限

批量导入权限配置（保存至 `acc.json` 后在开发者后台导入）：

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

<a id="命令速查"></a>
## 📖 命令速查

详见 [命令速查文档](assets/docs/commands.md)。

### 飞书命令

| 命令 | 说明 |
|---|---|
| `/help` | 查看帮助 |
| `/panel` | 打开控制面板 |
| `/model <provider:model>` | 切换模型 |
| `/agent <name>` | 切换 Agent |
| `/session new` | 开启新话题 |
| `/undo` | 撤回上一轮交互 |
| `/compact` | 压缩上下文 |
| `!<shell 命令>` | 透传 shell 命令 |
| `/commands` | 生成并发送最新命令清单文件 |
| `//<命令名>` | 透传命名空间 slash 命令（如 `//superpowers:brainstorming`） |

### Discord 命令

| 命令 | 说明 |
|---|---|
| `///session` | 查看绑定的会话 |
| `///new` | 新建并绑定会话 |
| `///bind <sessionId>` | 绑定已有会话 |
| `///undo` | 回撤上一轮 |
| `///compact` | 压缩上下文 |

<a id="agent使用"></a>
## 🤖 Agent（角色）使用

详见 [Agent 使用文档](assets/docs/agent.md)。

### 快速开始

- 查看当前 Agent：`/agent`
- 切换 Agent：`/agent <name>`
- 回到默认：`/agent off`

### 自定义 Agent

```text
创建角色 名称=旅行助手; 描述=擅长制定旅行计划; 类型=主; 工具=webfetch
```

<a id="关键实现细节"></a>
## 📌 关键实现细节

详见 [实现细节文档](assets/docs/implementation.md)。

- 权限请求回传：`response` 为 `once | always | reject`
- question 工具交互：答案通过用户文字回复解析
- 流式与思考卡片：文本与思考分流写入输出缓冲
- `/undo` 一致性：同时删除飞书侧消息并对 OpenCode 执行 `revert`

<a id="故障排查"></a>
## 🛠️ 故障排查

详见 [故障排查文档](assets/docs/troubleshooting.md)。

| 现象 | 优先检查 |
|---|---|
| 飞书发送消息后 OpenCode 无反应 | 检查飞书权限配置 |
| 点权限卡片后 OpenCode 无反应 | 确认回传值是 `once/always/reject` |
| `/compact` 失败 | 检查 OpenCode 可用模型 |
| 后台模式无法停止 | `logs/bridge.pid` 是否残留 |

<a id="详细文档"></a>
## 📚 详细文档

| 文档 | 说明 |
|---|---|
| [架构文档](assets/docs/architecture.md) | 项目分层设计与平台能力矩阵 |
| [配置中心](assets/docs/environment.md) | 完整业务配置说明（含 Web 面板配置） |
| [可靠性指南](assets/docs/reliability.md) | 心跳、Cron 与宕机救援配置 |
| [飞书后台配置](assets/docs/feishu-config.md) | 事件订阅与权限配置 |
| [命令速查](assets/docs/commands.md) | 完整命令列表与使用说明 |
| [实现细节](assets/docs/implementation.md) | 关键功能实现说明 |
| [故障排查](assets/docs/troubleshooting.md) | 常见问题与解决方案 |
| [部署运维](assets/docs/deployment.md) | 部署、升级与 systemd 配置 |
| [Agent 使用](assets/docs/agent.md) | 角色配置与自定义 Agent |
| [灰度部署](assets/docs/rollout.md) | 路由器模式灰度与回滚 SOP |
| [SDK API](assets/docs/sdk-api.md) | OpenCode SDK 集成指南 |
| [工作目录指南](assets/docs/workspace-guide.md) | 工作目录策略与项目配置 |

<a id="许可证"></a>
## 📝 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)

**GPL v3 意味着：**
- ✅ 可自由使用、修改和分发
- ✅ 可用于商业目的
- 📝 必须开源修改版本
- 📝 必须保留原作者版权
- 📝 衍生作品必须使用 GPL v3 协议

如果这个项目对你有帮助，请给个 ⭐️ Star！
