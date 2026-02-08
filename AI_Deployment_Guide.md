# AI 部署指南

本指南旨在为 AI 提供详细的部署步骤，确保能够独立、自动化地部署和运行 **飞书 × OpenCode 桥接服务**。

## 1. 环境准备

### 1.1 确认运行环境
请确保系统已安装 Node.js，版本要求 >= 20.0.0。
您可以通过运行以下命令检查 Node.js 版本：
```bash
node -v
```
如果未安装或版本不符合要求，请安装或升级 Node.js。

### 1.2 安装依赖
项目依赖于 `npm` 包管理器。在项目根目录下，执行以下命令安装所有依赖：
```bash
npm install
```

## 2. 配置

### 2.1 复制配置文件
项目使用 `.env` 文件进行环境配置。请将 `.env.example` 文件复制一份并命名为 `.env`：
```bash
cp .env.example .env
```

### 2.2 编辑 `.env` 文件
根据以下说明编辑 `.env` 文件中的各项配置。

```env
# 飞书应用配置（必填）
# FEISHU_APP_ID 和 FEISHU_APP_SECRET 用于连接飞书开放平台。
# 部署完成后，您需要从飞书开发者后台获取这些值。
FEISHU_APP_ID=cli_xxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# 用户白名单（选填）
# 允许使用本服务的飞书用户 open_id 列表，多个 ID 用逗号分隔。
# 如果留空，则不限制用户。为了安全，建议填写。
# 获取 open_id 的方法：给机器人发送一条消息，服务日志中会显示发送者的 open_id。
ALLOWED_USERS=ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 默认模型配置（选填）
# DEFAULT_PROVIDER 指定 OpenCode 使用的模型提供商 (e.g., anthropic)。
# DEFAULT_MODEL 指定具体的模型名称 (e.g., claude-sonnet-4-20250514)。
DEFAULT_PROVIDER=anthropic
DEFAULT_MODEL=claude-sonnet-4-20250514

# 自动允许的工具白名单（选填）
# 列出无需用户确认即可执行的工具名称，多个工具用逗号分隔。
# 示例：Read,Glob,Grep,Task,Write
TOOL_WHITELIST=Read,Glob,Grep,Task,Write

# 输出配置（选填）
# OUTPUT_UPDATE_INTERVAL: 输出更新间隔，单位毫秒 (ms)。
# 默认 3000 毫秒，用于控制飞书消息的发送频率，避免触发限流。
OUTPUT_UPDATE_INTERVAL=3000

# 延迟响应最大等待时间（选填）
# MAX_DELAYED_RESPONSE_WAIT_MS: 延迟响应的最大等待时间，单位毫秒 (ms)。
# 默认 120000 毫秒 (2 分钟)。超过此时间未收到 OpenCode 响应则发送提醒。
MAX_DELAYED_RESPONSE_WAIT_MS=120000

# 附件最大大小（选填）
# ATTACHMENT_MAX_SIZE: 允许传输的附件最大文件大小，单位字节 (byte)。
# 默认值 52428800 字节 (50MB)。
ATTACHMENT_MAX_SIZE=52428800
```

**重要提示：** `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是连接飞书开放平台的关键凭证。在部署完成后，需要从飞书开发者后台获取并填入。

## 3. 运行

本服务需要两个独立的进程协同工作：OpenCode 服务和桥接服务。

### 3.1 启动 OpenCode 服务

在第一个终端窗口中，启动 OpenCode 服务。通常使用以下命令：
```bash
opencode serve --port 4096
```
或者，如果您的 OpenCode 安装支持，可以直接运行 OpenCode，它会自动启动服务：
```bash
opencode --port 4096
```
请确保 OpenCode 服务已成功启动并在指定端口（默认 4096）监听。

### 3.2 配置 OpenCode (可选)

为了避免每次启动 OpenCode 时都需要指定参数（如端口），您可以修改 OpenCode 的配置文件。

**配置文件位置**：
- Windows: `C:\Users\{用户名}\.config\opencode\config.json`
- Linux/macOS: `~/.config/opencode/config.json` (或 `/root/.config/opencode/config.json`)

**检查与修改**：
请读取该文件，检查是否存在 `server` 配置块。如果不存在或配置不正确，请添加或修改为以下内容：

```json
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0",
    "cors": [
      "*"
    ]
  }
```

*注意：如果文件中已有其他配置，请保留，仅添加或合并 `server` 部分。*

配置完成后，您只需运行 `opencode serve` 或 `opencode` 即可，无需附加参数。

### 3.3 启动桥接服务

在第二个终端窗口中，启动 **飞书 × OpenCode 桥接服务**：
```bash
npm run dev
```
此命令将以开发模式启动服务，支持热重载。如果需要生产环境运行，请使用 `npm start`。

## 4. 验证部署

服务启动后，您可以通过以下方式验证部署是否成功：

1.  **飞书机器人消息测试**: 在飞书客户端向机器人发送一条消息。如果配置正确，服务日志中应显示消息接收和处理信息。
2.  **日志监控**: 检查两个终端窗口的输出日志，确保没有错误信息，并能看到正常的交互日志（例如 `[飞书]`、`[OpenCode]` 等前缀的日志）。
3.  **OpenCode 交互测试**: 尝试发送一些控制命令，例如 `/model list` 或 `/status`，检查机器人是否能正确响应。

## 5. 故障排除

如果遇到部署或运行问题，请参考 `README.md` 中的“常见问题”章节和详细日志进行排查。

---
**致 AI 开发者**:

本指南应作为您部署此项目的唯一参考。请严格按照上述步骤执行，并在遇到问题时优先查阅项目文档。
所有必要的配置和运行指令都已提供。部署成功后，请确保系统稳定运行，并对用户指令做出正确响应。
