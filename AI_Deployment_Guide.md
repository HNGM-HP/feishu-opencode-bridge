# AI Deployment Guide

本文件是给 AI 代理执行部署任务的操作手册，目标是让代理在不猜测的前提下，稳定完成 **飞书 x OpenCode 桥接服务** 的部署与验收。

## 1. 事实基线（来自仓库）

- Node.js 要求：`>= 18`（见 `package.json`）。
- 桥接服务默认入口：`dist/index.js`。
- 可用部署脚本（跨平台）：
  - `scripts/deploy.mjs`（菜单 + deploy/start/stop + Linux systemd）
  - `scripts/start.mjs`（后台启动）
  - `scripts/stop.mjs`（后台停止）
- 脚本会自动检测 npm；若未检测到，会先询问是否显示安装引导，再由用户确认后处理。
- 会话状态持久化：`.chat-sessions.json`。

## 2. 部署原则

- 先验证环境，再执行部署。
- 配置以 `src/config.ts` 实际读取字段为准。
- 不把运行态文件（例如 `.chat-sessions.json`）作为部署产物提交。
- 优先使用仓库内置脚本，不手写临时启动命令链。

## 3. 标准部署流程

### 步骤 A：环境检查

```bash
node -v
npm -v
```

要求 Node 主版本 >= 18。

### 步骤 B：准备配置

```bash
cp .env.example .env
```

至少填写：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

建议同时确认：

- `OPENCODE_HOST`（默认 `localhost`）
- `OPENCODE_PORT`（默认 `4096`）
- `TOOL_WHITELIST`
- `OUTPUT_UPDATE_INTERVAL`
- `ATTACHMENT_MAX_SIZE`

### 步骤 C：部署桥接

推荐命令（优先用平台脚本入口）：

```bash
bash scripts/deploy.sh deploy
```

Windows PowerShell：

```powershell
.\scripts\deploy.ps1 deploy
```

这些入口会先自动检测 Node.js 与 npm：
- **Windows**：若未检测到 Node.js，会询问是否自动安装（优先使用 winget，其次 choco），安装后自动重试。
- **Linux/macOS**：若未检测到，会询问是否显示安装引导，再由用户确认后重试检测。

### 步骤 D：启动 OpenCode

```bash
opencode serve --port 4096
```

如果你修改了 `.env` 中 OpenCode 端口，启动命令与其保持一致。

### 步骤 E：启动桥接服务

开发模式：

```bash
npm run dev
```

后台模式：

```bash
node scripts/start.mjs
```

停止后台：

```bash
node scripts/stop.mjs
```

更新升级（先拆卸清理再更新）：

```bash
bash scripts/deploy.sh upgrade
```

## 4. 平台速查

| 平台 | 菜单 | 一键部署 | 启动后台 | 停止后台 | 更新升级 |
|---|---|---|---|---|---|
| Linux/macOS | `./scripts/deploy.sh menu` | `./scripts/deploy.sh deploy` | `./scripts/start.sh` | `./scripts/stop.sh` | `./scripts/deploy.sh upgrade` |
| Windows PowerShell | `.\\scripts\\deploy.ps1 menu` | `.\\scripts\\deploy.ps1 deploy` | `.\\scripts\\start.ps1` | `.\\scripts\\stop.ps1` | `.\\scripts\\deploy.ps1 upgrade` |

## 5. Linux systemd 常驻部署

前提：Linux + systemd + root 权限。

```bash
sudo node scripts/deploy.mjs service-install
sudo node scripts/deploy.mjs status
```

停用/卸载：

```bash
sudo node scripts/deploy.mjs service-disable
sudo node scripts/deploy.mjs service-uninstall
```

日志位置：

- `logs/service.log`
- `logs/service.err`

## 6. 飞书侧最小检查清单

- 事件订阅：
  - `im.message.receive_v1`
  - `card.action.trigger`
  - `im.message.recalled_v1`
  - `im.chat.member.user.deleted_v1`
  - `im.chat.disbanded_v1`
- 权限：
  - `im:message`
  - `im:chat`
  - `im:resource`

## 7. 验收步骤

1. 在飞书群聊 @机器人发送普通文本。
2. 观察是否收到流式回复。
3. 触发一次权限请求，确认卡片按钮可用。
4. 触发一次 question 提问，确认可以回复并继续对话。
5. 执行 `/undo`，确认 OpenCode 和飞书消息都回滚。

## 8. 常见异常与处理

- 权限卡点击无效：检查回传是否为 `once | always | reject`。
- 权限/提问卡未发送：检查 `.chat-sessions.json` 是否存在对应 `sessionId -> chatId` 映射。
- 卡片更新失败：通常是消息类型不匹配，检查是否已自动降级为重发卡片。
- 后台进程残留：删除 `logs/bridge.pid` 前先确认目标进程是否仍在运行。

## 9. AI 代理执行要求

- 不确定时先读源码再判断，不依赖历史印象。
- 若用户要求提交代码，仅提交本次任务相关文件。
- 推送前给出可复现的验证结果（至少包含构建/启动结果）。
