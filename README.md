# OpenCode Bridge

[![v2.9.51](https://img.shields.io/badge/v2.9.51-3178C6)]()
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[中文](README.md) | [English](README-en.md)**

---

> **OpenCode Bridge** 是一款企业级 AI 编程协作桥接服务，将 OpenCode（AI 编程助手）无缝接入主流即时通讯平台，实现跨平台、跨设备的智能编程协作体验。

---

## 📱 支持平台

### 平台概览

| 平台 | 状态 | 登录方式 |
|------|------|----------|
| 飞书 (Lark) | ✅ 完整支持 | 机器人应用 |
| Discord | ✅ 完整支持 | Bot Token |
| 企业微信 (WeCom) | ✅ 完整支持 | 机器人应用 |
| Telegram | ✅ 完整支持 | Bot Token |
| QQ (OneBot) | ✅ 完整支持 | OneBot 协议 |
| WhatsApp | ✅ 完整支持 | 手机号配对 |
| 个人微信 | ✅ 完整支持 | 扫码登录 |
| 钉钉 (DingTalk) | ✅ 完整支持 | 机器人应用 |

### 功能支持对比

| 功能 | 飞书 | Discord | 企业微信 | Telegram | QQ | WhatsApp | 微信 | 钉钉 |
|------|:----:|:-------:|:--------:|:--------:|:--:|:--------:|:----:|:----:|
| 文本消息 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 富媒体/卡片 | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| 流式输出 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 权限交互 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 文件传输 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| 群聊支持 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 私聊支持 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 消息撤回 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## ✨ 核心特性

### 🔄 智能会话管理
- **独立会话绑定**：每个群聊/私聊独立绑定 OpenCode 会话，上下文互不干扰
- **会话迁移**：支持会话绑定、迁移、重命名，跨设备接力不断裂
- **多项目支持**：支持多项目目录切换，项目别名配置
- **自动清理**：自动清理无效会话，防止资源泄漏

### 🤖 AI 交互能力
- **流式输出**：实时显示 AI 响应，支持思维链展示
- **权限交互**：AI 权限请求在聊天平台内完成确认
- **问题回答**：AI 提问在聊天平台内完成作答
- **文件传输**：AI 可将文件/截图发送到聊天平台
- **Shell 透传**：白名单命令可直接在聊天中执行

### 🛡️ 可靠性保障
- **心跳监控**：定时探测 OpenCode 健康状态
- **自动救援**：OpenCode 宕机时自动重启恢复
- **Cron 任务**：支持运行时动态管理定时任务
- **日志审计**：完整的操作日志和错误追踪

### 🎛️ Web 管理面板
- **可视化配置**：浏览器实时修改所有配置参数
- **平台管理**：查看各平台连接状态
- **Cron 管理**：创建、启用/禁用、删除定时任务
- **服务控制**：查看服务状态、远程重启

---

## 🚀 快速开始

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

## 📝 命令速查

### 通用命令

以下命令在所有平台均可使用：

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助 |
| `/status` | 查看当前状态 |
| `/panel` | 显示控制面板 |
| `/model` | 查看当前模型 |
| `/model <名称>` | 切换模型 |
| `/models` | 列出所有可用模型 |
| `/agent` | 查看当前角色 |
| `/agent <名称>` | 切换角色 |
| `/agents` | 列出所有可用角色 |
| `/effort` | 查看当前推理强度 |
| `/effort <档位>` | 设置推理强度 |
| `/session new` | 开启新话题 |
| `/sessions` | 列出会话 |
| `/undo` | 撤回上一轮交互 |
| `/stop` | 停止当前回答 |
| `/compact` | 压缩上下文 |
| `/rename <名称>` | 重命名会话 |
| `/project list` | 列出可用项目 |
| `/clear` | 重置对话上下文 |

### 飞书专属命令

| 命令 | 说明 |
|------|------|
| `/send <路径>` | 发送文件到群聊 |
| `/cron ...` | 管理 Cron 任务 |
| `/commands` | 生成命令清单文件 |
| `/create_chat` | 私聊中调出建群卡片 |
| `!<shell 命令>` | 透传 Shell 命令（白名单） |
| `//xxx` | 透传命名空间命令 |

### Discord 专属命令

| 命令 | 说明 |
|------|------|
| `///session` | 查看绑定的会话 |
| `///new` | 新建并绑定会话 |
| `///bind <sessionId>` | 绑定已有会话 |
| `///undo` | 撤回上一轮 |
| `///compact` | 压缩上下文 |
| `///workdir` | 设置工作目录 |
| `///cron ...` | 管理 Cron 任务 |

---

## 🏗️ 架构概览

### 系统架构图

```mermaid
flowchart LR
    %% 样式定义
    classDef platform fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,rx:8px
    classDef core fill:#fff3e0,stroke:#f57c00,stroke-width:2px,rx:8px
    classDef handler fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,rx:8px
    classDef opencode fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,rx:8px
    classDef external fill:#fce4ec,stroke:#c2185b,stroke-width:2px,rx:8px,stroke-dasharray:5 5

    subgraph PlatformLayer["📱 平台适配层"]
        direction TB
        feishu["✈️ 飞书"]:::platform
        discord["🎮 Discord"]:::platform
        wecom["💼 企业微信"]:::platform
        telegram["📤 Telegram"]:::platform
        qq["🐧 QQ"]:::platform
        whatsapp["📞 WhatsApp"]:::platform
        weixin["💬 微信"]:::platform
        dingtalk["📌 钉钉"]:::platform
    end

    subgraph CoreLayer["⚙️ 核心处理层"]
        direction TB
        router["🔀 路由中心<br/><b>RootRouter</b>"]:::core

        subgraph Handlers["处理模块"]
            direction LR
            permission["🔐 权限处理"]:::handler
            question["❓ 问题作答"]:::handler
            output["📤 输出缓冲"]:::handler
        end
    end

    subgraph IntegrationLayer["🔗 集成层"]
        sdk["🔌 OpenCode SDK<br/><b>OpencodeClient</b>"]:::opencode
    end

    subgraph External["🌐 外部服务"]
        opencode["🤖 OpenCode 服务"]:::external
        cli["💻 OpenCode CLI"]:::external
    end

    %% 连接关系
    PlatformLayer --> router
    router --> Handlers
    Handlers --> sdk
    sdk --> opencode
    opencode -.-> cli
```

**架构说明：**

| 层级 | 职责 | 关键组件 |
|------|------|----------|
| 📱 平台适配层 | 接收各平台消息，统一格式转换 | 8 个平台适配器 |
| ⚙️ 核心处理层 | 消息路由、权限验证、业务处理 | RootRouter、Permission、Question、Output |
| 🔗 集成层 | 与 OpenCode 通信，发送/接收请求 | OpencodeClient SDK |
| 🌐 外部服务 | 实际的 AI 服务和命令行工具 | OpenCode 服务、CLI |

---

## 📚 文档导航

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
| [钉钉配置](assets/docs/dingtalk-config.md) | 钉钉机器人 Stream 模式配置指南 |

### 扩展文档

| 文档 | 说明 |
|------|------|
| [Agent 使用](assets/docs/agent.md) | 角色配置与自定义 Agent |
| [实现细节](assets/docs/implementation.md) | 关键功能实现说明 |
| [SDK API](assets/docs/sdk-api.md) | OpenCode SDK 集成指南 |
| [工作目录指南](assets/docs/workspace-guide.md) | 工作目录策略与项目配置 |
| [灰度部署](assets/docs/rollout.md) | 路由器模式灰度与回滚 |

---

## 📋 环境要求

- **Node.js**: >= 18.0.0
- **操作系统**: Linux / macOS / Windows
- **OpenCode**: 需要安装并运行

---

## 🔧 配置说明

### 配置管理方式

| 方式 | 说明 |
|------|------|
| Web 面板（推荐） | 访问 `http://localhost:4098` 可视化配置 |
| SQLite 数据库 | 配置存储在 `data/config.db` |
| .env 文件 | 仅存储 Admin 面板启动参数 |

### 核心配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `FEISHU_ENABLED` | `false` | 是否启用飞书适配器 |
| `DISCORD_ENABLED` | `false` | 是否启用 Discord 适配器 |
| `OPENCODE_HOST` | `localhost` | OpenCode 地址 |
| `OPENCODE_PORT` | `4096` | OpenCode 端口 |
| `ADMIN_PORT` | `4098` | Web 配置面板监听端口 |

完整配置参数请参考 [配置中心文档](assets/docs/environment.md)。

---

## 📄 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)

**GPL v3 意味着：**
- ✅ 可自由使用、修改和分发
- ✅ 可用于商业目的
- ✅ 必须开源修改版本
- ✅ 必须保留原作者版权
- ✅ 衍生作品必须使用 GPL v3 协议

---

## 🌟 贡献与反馈

如果这个项目对你有帮助，请给个 Star！

遇到问题或有改进建议，欢迎提交 [Issue](https://github.com/HNGM-HP/opencode-bridge/issues) 或 [Pull Request](https://github.com/HNGM-HP/opencode-bridge/pulls)。

---

## 📞 技术支持

- **GitHub Issues**: [问题反馈](https://github.com/HNGM-HP/opencode-bridge/issues)
- **项目主页**: [GitHub Repository](https://github.com/HNGM-HP/opencode-bridge)
