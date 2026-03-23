# OpenCode Bridge

[![v2.9.5-beta](https://img.shields.io/badge/v2.9.5--beta-3178C6)]()
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[中文](README.md) | [English](README-en.md)**

---

**飞书 / Discord / 企业微信 / Telegram / QQ / WhatsApp / 个人微信 × OpenCode 多平台桥接服务**

将 AI 编程助手 OpenCode 接入主流即时通讯平台，实现跨平台、跨设备的智能编程协作体验。

---

## 核心功能

### 多平台统一接入

| 平台 | 状态 | 特性 |
|------|------|------|
| 飞书 (Lark) | 完整支持 | 卡片交互、流式输出、权限确认、文件传输 |
| Discord | 完整支持 | 组件交互、Embed 消息、Slash 命令 |
| 企业微信 (WeCom) | 完整支持 | 文本交互、消息收发 |
| Telegram | 完整支持 | 文本交互、Inline 键盘 |
| QQ (OneBot) | 完整支持 | 文本交互、群聊支持 |
| WhatsApp | 完整支持 | 文本交互、媒体消息 |
| 个人微信 | 完整支持 | 扫码登录、文本交互 |

### 智能会话管理

- **独立会话**：每个群聊/私聊独立绑定 OpenCode 会话，互不干扰
- **会话迁移**：支持会话绑定、迁移、重命名，跨设备接力不断裂
- **项目目录**：支持多项目目录切换，项目别名配置
- **会话清理**：自动清理无效会话，防止资源泄漏

### AI 交互能力

- **流式输出**：实时显示 AI 响应，支持思维链展示
- **权限交互**：AI 权限请求在聊天平台内完成确认
- **问题回答**：AI 提问在聊天平台内完成作答
- **文件传输**：AI 可将文件/截图发送到聊天平台
- **Shell 透传**：白名单命令可直接在聊天中执行

### 可靠性保障

- **心跳监控**：定时探测 OpenCode 健康状态
- **自动救援**：OpenCode 宕机时自动重启恢复
- **Cron 任务**：支持运行时动态管理定时任务
- **日志审计**：完整的操作日志和错误追踪

### Web 管理面板

- **可视化配置**：浏览器实时修改所有配置参数
- **平台管理**：查看各平台连接状态
- **Cron 管理**：创建、启用/禁用、删除定时任务
- **服务控制**：查看服务状态、远程重启

---

## 核心特点

### 对使用者友好

- 权限确认、问题作答、会话操作都在聊天平台内完成
- 不强依赖本地终端，随时随地使用 AI 编程助手

### 对协作友好

- 支持绑定已有会话与迁移绑定
- 跨设备、跨群接力时上下文不断裂
- 多人协作共享同一 AI 会话

### 对稳定性友好

- 会话映射持久化存储
- 双端撤回一致性保障
- 同规则清理避免状态错位

### 对运维友好

- 内置部署、升级、状态检查与后台管理流程
- 支持 systemd 常驻运行
- 完整的日志和监控体系

### 对配置友好

- Web 可视化配置中心
- 实时修改配置（部分敏感配置除外）
- 配置存储于 SQLite 数据库，支持备份恢复

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
```

### 2. 一键部署

**Linux/macOS:**
```bash
chmod +x ./scripts/deploy.sh
./scripts/deploy.sh guide
```

**Windows PowerShell:**
```powershell
.\scripts\deploy.ps1 guide
```

该命令会自动完成：
- 检测并引导安装 Node.js
- 检测并引导安装 OpenCode
- 安装项目依赖并编译
- 生成初始配置文件

### 3. 启动服务

**Linux/macOS:**
```bash
./scripts/start.sh
```

**Windows PowerShell:**
```powershell
.\scripts\start.ps1
```

**开发模式:**
```bash
npm run dev
```

### 4. 配置平台

服务启动后，访问 Web 配置面板完成平台配置：

```
http://localhost:4098
```

首次访问时会提示设置管理密码。

---

## 命令速查

### 飞书命令

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助 |
| `/panel` | 打开控制面板（模型、角色、强度） |
| `/model <provider:model>` | 切换模型 |
| `/agent <name>` | 切换 Agent |
| `/effort <档位>` | 设置推理强度 |
| `/session new` | 开启新话题 |
| `/session <sessionId>` | 绑定已有会话 |
| `/undo` | 撤回上一轮交互 |
| `/compact` | 压缩上下文 |
| `/project list` | 列出可用项目 |
| `/send <路径>` | 发送文件到群聊 |
| `/cron ...` | 管理 Cron 任务 |
| `!<shell命令>` | 透传 Shell 命令 |

### Discord 命令

| 命令 | 说明 |
|------|------|
| `///session` | 查看绑定的会话 |
| `///new` | 新建并绑定会话 |
| `///bind <sessionId>` | 绑定已有会话 |
| `///undo` | 撤回上一轮 |
| `///compact` | 压缩上下文 |
| `///workdir` | 设置工作目录 |
| `///cron ...` | 管理 Cron 任务 |

### 企业微信命令

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助 |
| `/panel` | 打开控制面板 |
| `/model <provider:model>` | 切换模型 |
| `/agent <name>` | 切换 Agent |
| `/session new` | 开启新话题 |
| `/undo` | 撤回上一轮交互 |
| `/compact` | 压缩上下文 |

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      平台适配层                              │
│  Feishu │ Discord │ WeCom │ Telegram │ QQ │ WhatsApp │ Weixin │
└────┬────────┬────────┬────────┬────────┬────────┬──────────┘
     │        │        │        │        │        │
     └────────┴────────┴────────┴────────┴────────┘
                        │
              ┌─────────▼─────────┐
              │     路由层        │
              │   RootRouter      │
              └─────────┬─────────┘
                        │
     ┌──────────────────┼──────────────────┐
     │                  │                  │
┌────▼────┐      ┌─────▼─────┐      ┌─────▼─────┐
│权限处理 │      │ 问题处理  │      │ 输出缓冲  │
│Permission│     │ Question  │      │ Output    │
└────┬────┘      └─────┬─────┘      └─────┬─────┘
     │                 │                  │
     └─────────────────┼──────────────────┘
                       │
             ┌─────────▼─────────┐
             │   OpenCode 集成   │
             │  OpencodeClient   │
             └─────────┬─────────┘
                       │
             ┌─────────▼─────────┐
             │   OpenCode CLI    │
             └───────────────────┘
```

---

## 详细文档

### 核心文档

| 文档 | 说明 |
|------|------|
| [架构设计](assets/docs/architecture.md) | 项目分层设计与核心模块职责 |
| [配置中心](assets/docs/environment.md) | 完整配置参数说明 |
| [部署运维](assets/docs/deployment.md) | 部署、升级与 systemd 配置 |
| [命令速查](assets/docs/commands.md) | 完整命令列表与使用说明 |
| [可靠性指南](assets/docs/reliability.md) | 心跳、Cron 与宕机救援配置 |
| [故障排查](assets/docs/troubleshooting.md) | 常见问题与解决方案 |

### 平台配置文档

| 文档 | 说明 |
|------|------|
| [飞书配置](assets/docs/feishu-config.md) | 飞书事件订阅与权限配置 |
| [Discord 配置](assets/docs/discord-config.md) | Discord 机器人配置指南 |
| [企业微信配置](assets/docs/wecom-config.md) | 企业微信机器人配置指南 |
| [Telegram 配置](assets/docs/telegram-config.md) | Telegram Bot 配置指南 |
| [QQ 配置](assets/docs/qq-config.md) | QQ 官方/OneBot 协议配置指南 |
| [WhatsApp 配置](assets/docs/whatsapp-config.md) | WhatsApp Personal/Business 配置指南 |
| [微信个人号配置](assets/docs/weixin-config.md) | 微信个人号配置指南 |

### 扩展文档

| 文档 | 说明 |
|------|------|
| [Agent 使用](assets/docs/agent.md) | 角色配置与自定义 Agent |
| [实现细节](assets/docs/implementation.md) | 关键功能实现说明 |
| [SDK API](assets/docs/sdk-api.md) | OpenCode SDK 集成指南 |
| [工作目录指南](assets/docs/workspace-guide.md) | 工作目录策略与项目配置 |
| [灰度部署](assets/docs/rollout.md) | 路由器模式灰度与回滚 |

---

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)

**GPL v3 意味着：**
- 可自由使用、修改和分发
- 可用于商业目的
- 必须开源修改版本
- 必须保留原作者版权
- 衍生作品必须使用 GPL v3 协议

---

如果这个项目对你有帮助，请给个 Star！