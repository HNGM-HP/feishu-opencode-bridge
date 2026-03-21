# 企业微信配置指南

本文档介绍如何配置企业微信机器人以连接到 OpenCode Bridge。

## 前置条件

1. 已部署 OpenCode Bridge 服务
2. 已安装并运行 OpenCode
3. 已创建企业微信应用或机器人

## 配置步骤

### 1. 启用企业微信适配器

在 Web 配置面板（`http://localhost:4098`）中：

1. 进入"平台接入" → "企业微信（WeCom）"配置
2. 将"是否启用企业微信适配器"设置为 `true`
3. 填写企业微信 Bot ID
4. 填写企业微信 Secret
5. 保存配置

### 2. 获取企业微信凭证

#### 获取 Bot ID

1. 登录企业微信管理后台
2. 进入"应用管理" → "应用" → "自建"
3. 创建或选择已有的应用
4. 在应用详情页面，复制"AgentId"作为 Bot ID

#### 获取 Secret

1. 在应用详情页面，点击"Secret"旁边的"查看"按钮
2. 复制 Secret 值

### 3. 配置消息接收

1. 在应用详情页面，找到"接收消息"配置
2. 设置 API 接收地址为：
   ```
   http://your-server-address:your-port/wecom/webhook
   ```
3. 保存配置

### 4. 配置权限

在企业微信管理后台，确保应用具有以下权限：

- 发送消息到用户/部门/标签
- 读取用户信息
- 管理通讯录（可选）

## 配置参数

| 参数 | 说明 | 示例 |
|---|---|---|
| `WECOM_ENABLED` | 是否启用企业微信适配器 | `true` |
| `WECOM_BOT_ID` | 企业微信 Bot ID (AgentId) | `1000002` |
| `WECOM_SECRET` | 企业微信 Secret | `your-secret-here` |
| `WECOM_SHOW_THINKING_CHAIN` | 显示 AI 思维链 | `true` |
| `WECOM_SHOW_TOOL_CHAIN` | 显示工具调用链 | `true` |
| `RELIABILITY_CRON_FALLBACK_WECOM_CONVERSATION_ID` | 备用接收 conversationId | `userid 或 groupid` |

## 企业微信命令

| 命令 | 说明 |
|---|---|
| `/help` | 查看帮助 |
| `/panel` | 打开控制面板 |
| `/model <provider:model>` | 切换模型 |
| `/agent <name>` | 切换 Agent |
| `/session new` | 开启新话题 |
| `/undo` | 撤回上一轮交互 |
| `/compact` | 压缩上下文 |

## 故障排查

### 企业微信无响应

1. 检查 `WECOM_ENABLED` 是否设置为 `true`
2. 检查 `WECOM_BOT_ID` 和 `WECOM_SECRET` 是否正确
3. 检查消息接收地址是否正确配置
4. 查看服务日志中的错误信息

### 消息发送失败

1. 检查应用权限是否足够
2. 检查用户/群组 ID 是否正确
3. 检查网络连接是否正常

## 注意事项

1. 企业微信适配器目前支持文本消息交互
2. 不支持富文本卡片（与飞书不同）
3. 文件发送功能受限于企业微信 API 限制
4. 建议在测试群组中先验证配置
