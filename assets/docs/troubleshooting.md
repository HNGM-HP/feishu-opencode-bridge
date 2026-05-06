# 故障排查指南

本文档提供 OpenCode Bridge 常见问题的解决方案。

---

## 快速诊断流程

```
问题发生
    │
    ▼
1. 查看服务日志 → logs/service.log, logs/service.err
    │
    ▼
2. 检查配置 → Web 面板或 data/config.db
    │
    ▼
3. 检查平台状态 → 各平台机器人/应用状态
    │
    ▼
4. 检查 OpenCode → 是否运行、是否可访问
    │
    ▼
5. 重启服务 → 多数问题可临时解决
```

---

## 1. 桌面应用安装问题

### 1.1 macOS 提示"已损坏"

**问题现象**：
```
"OpenCode Bridge" 已损坏，无法打开。你应该将它移到废纸篓。
```

**原因说明**：
- macOS 的安全机制（Gatekeeper）阻止了未签名的应用运行
- 本项目为开源免费项目，未购买 Apple Developer 证书进行代码签名
- 这是 macOS 对所有未签名应用的正常保护行为

**解决方案**（任选其一）：

#### 方法 1：右键强制打开（最简单）
```
1. 在 Finder 中找到 "OpenCode Bridge.app"
2. 右键点击应用图标
3. 按住键盘上的 "Option"（⌥）键
4. 双击 "打开" 菜单项
5. 在弹出的确认对话框中点击 "打开"
```

**一次性操作后**，以后就可以正常双击启动了。

#### 方法 2：系统设置解除限制
```
1. 点击 "取消" 关闭错误对话框
2. 打开 "系统设置" → "隐私与安全性"
3. 向下滚动找到 "OpenCode Bridge 被阻止" 的提示
4. 点击 "仍要打开" 按钮
5. 再次输入管理员密码确认
```

#### 方法 3：命令行移除隔离属性
```bash
# 打开终端（Terminal），执行以下命令
xattr -cr /Applications/OpenCode\ Bridge.app

# 如果应用在其他位置，替换为实际路径
xattr -cr "/path/to/OpenCode Bridge.app"
```

**原理解释**：
- `xattr` 命令用于查看和修改文件的扩展属性
- `-c` 参数清除所有扩展属性
- `-r` 参数递归处理应用包内的所有文件
- macOS 通过 `com.apple.quarantine` 属性标记下载的文件，移除后 Gatekeeper 不再拦截

#### 方法 4：终端直接启动
```bash
# 在终端中执行（无需任何参数）
open /Applications/OpenCode\ Bridge.app
```

---

### 1.2 Windows 提示"未识别的应用"

**问题现象**：
```
Windows 已保护你的电脑
Microsoft Defender SmartScreen 筛选器已阻止无法识别的应用启动。运行此应用可能会导致你的电脑存在风险。
```

**解决方案**：
```
1. 点击 "更多信息" 链接
2. 点击 "仍要运行" 按钮
```

**原因说明**：
- Windows Defender SmartScreen 对没有数字签名的应用会显示此警告
- 这是正常的保护机制，不是病毒或恶意软件
- 确认一次后，SmartScreen 会记住此应用，下次不再提示

---

### 1.3 应用启动后无法访问管理面板

**现象**：桌面应用已启动，但浏览器无法访问 `http://localhost:4098`

**排查步骤**：

#### 1. 确认应用是否运行
- **Windows**：查看系统托盘（右下角通知区域）是否有 OpenCode Bridge 图标
- **macOS**：查看顶部菜单栏是否有托盘图标

#### 2. 检查端口是否被占用
```bash
# Windows PowerShell
netstat -ano | findstr :4098

# macOS/Linux
lsof -i :4098
```

如果端口被占用，可以：
1. 停止占用端口的进程
2. 或修改 `.env` 文件中的 `ADMIN_PORT` 配置

#### 3. 手动打开管理面板
直接在浏览器地址栏输入：
```
http://localhost:4098
```

#### 4. 查看日志文件
- **Windows**：
  ```
  %APPDATA%\opencode-bridge\logs\service.log
  %APPDATA%\opencode-bridge\logs\service.err
  ```
- **macOS**：
  ```
  ~/Library/Application Support/opencode-bridge/logs/service.log
  ~/Library/Application Support/opencode-bridge/logs/service.err
  ```

#### 5. 重启应用
- 右键托盘图标 → 选择 "停止服务" → 等待 3 秒 → 选择 "启动服务"
- 或直接退出应用后重新启动

---

### 1.4 应用启动但立即退出

**可能原因**：

#### 原因 1：配置文件损坏
```bash
# 删除配置文件（会丢失所有配置，请谨慎操作）
# Windows
del %APPDATA%\opencode-bridge\data\config.db

# macOS
rm ~/Library/Application\ Support/opencode-bridge/data/config.db
```

#### 原因 2：依赖的 OpenCode 服务未运行
1. 确认 OpenCode 已安装并运行
2. 检查 OpenCode 的默认端口（4096）是否可访问
```bash
curl http://localhost:4096
```

#### 原因 3：Node.js 版本不兼容
- 确保系统安装了 Node.js 20.0.0 或更高版本
- 下载地址：https://nodejs.org/

---

### 1.5 如何完全卸载

**Windows**：
```
1. 通过 "设置" → "应用" → "OpenCode Bridge" → "卸载"
2. 手动删除残留文件：
   - %APPDATA%\opencode-bridge
   - %LOCALAPPDATA%\opencode-bridge
```

**macOS**：
```bash
# 1. 退出应用（右键托盘图标 → 退出）
# 2. 删除应用
sudo rm -rf /Applications/OpenCode\ Bridge.app

# 3. 删除配置文件（可选）
rm -rf ~/Library/Application\ Support/opencode-bridge
rm -rf ~/Library/Caches/opencode-bridge
rm -rf ~/Library/Preferences/com.github.hngm-hp.opencode-bridge.plist
```

---

## 2. 飞书相关

| 现象 | 优先检查 |
|------|----------|
| 飞书发送消息后 OpenCode 无反应 | 检查飞书权限；确认 [飞书后台配置](feishu-config.md) 正确 |
| 点权限卡片后 OpenCode 无反应 | 日志是否出现权限回传失败；确认回传值是 `once/always/reject` |
| 权限卡或提问卡发不到群 | `.chat-sessions.json` 中 `sessionId -> chatId` 映射是否存在 |
| 卡片更新失败 | 消息类型是否匹配；失败后是否降级为重发卡片 |

---

## 2. Discord 相关

| 现象 | 优先检查 |
|------|----------|
| Discord 发送消息后 OpenCode 无反应 | 检查 `DISCORD_ENABLED` 是否为 `true`；检查 `DISCORD_TOKEN` 是否正确 |
| 机器人显示离线 | 检查 Bot Token 是否有效；检查网络连接 |
| 命令不工作 | 确保 Message Content Intent 已开启；检查机器人权限 |
| 文件发送失败 | 检查文件大小是否超过 Discord 限制（8MB/50MB） |

---

## 3. 企业微信相关

| 现象 | 优先检查 |
|------|----------|
| 企业微信发送消息后 OpenCode 无反应 | 检查 `WECOM_ENABLED` 是否为 `true`；检查 `WECOM_BOT_ID` 和 `WECOM_SECRET` 是否正确 |
| 消息接收地址配置错误 | 确认 Webhook URL 配置正确 |
| 应用权限不足 | 检查企业微信应用权限设置 |

---

## 4. Telegram 相关

| 现象 | 优先检查 |
|------|----------|
| 发送消息后无响应 | 检查 `TELEGRAM_ENABLED` 是否为 `true`；检查 `TELEGRAM_BOT_TOKEN` |
| 机器人显示离线 | 检查 Bot Token 是否有效；检查网络连接 |

---

## 5. QQ 相关

| 现象 | 优先检查 |
|------|----------|
| 发送消息后无响应 | 检查 `QQ_ENABLED` 是否为 `true`；检查 OneBot 连接 |
| OneBot 连接失败 | 检查 `QQ_ONEBOT_HTTP_URL` 和 `QQ_ONEBOT_WS_URL` |

---

## 6. WhatsApp 相关

| 现象 | 优先检查 |
|------|----------|
| 无法生成二维码 | 网络问题；检查网络连接 |
| 登录后立即断开 | 账号被限制；等待一段时间后重试 |
| 会话失效 | 长时间未活动；重新扫码登录 |

---

## 7. 微信个人号相关

| 现象 | 优先检查 |
|------|----------|
| 账号自动暂停 | 会话过期（errcode -14）；检查 Token 是否有效 |
| 消息发送失败 | context_token 失效；确保接收过对方消息以获取 token |
| 收不到消息 | 账号未启用；检查 `enabled` 字段是否为 1 |

---

## 8. OpenCode 相关

| 现象 | 优先检查 |
|------|----------|
| `/compact` 失败 | OpenCode 可用模型是否正常；必要时先 `/model <provider:model>` 再重试 |
| `!ls` 等 shell 命令失败 | 当前会话 Agent 是否可用；可先执行 `/agent general` 再重试 |
| OpenCode 连接失败 | 检查 `OPENCODE_HOST` 和 `OPENCODE_PORT` 配置；检查 OpenCode 是否运行 |
| 认证失败（401/403） | 检查 `OPENCODE_SERVER_USERNAME` 和 `OPENCODE_SERVER_PASSWORD` 配置 |
| OpenCode 大于 `v1.2.15` 版本发消息无响应 | 检查 `~/.config/opencode/opencode.json` 是否有 `"default_agent": "companion"`，有请删除 |

---

## 9. 可靠性相关

| 现象 | 优先检查 |
|------|----------|
| 心跳似乎没有执行 | 检查 `HEARTBEAT.md` 是否把检查项标记为 `- [ ]`；检查 `memory/heartbeat-state.json` 的 `lastRunAt` 是否更新 |
| 自动救援没有触发 | 检查 `OPENCODE_HOST` 是否为 loopback、`RELIABILITY_LOOPBACK_ONLY` 是否开启、失败次数/窗口是否达到阈值 |
| 自动救援被拒绝 | 检查 `logs/reliability-audit.jsonl` 的 `reason` 字段 |
| 找不到备份配置 | 检查 `logs/reliability-audit.jsonl` 的 `backupPath` |
| Cron 任务不执行 | 检查 `RELIABILITY_CRON_ENABLED` 是否为 `true`；检查 Cron 任务状态 |

---

## 10. Web 配置面板相关

| 现象 | 优先检查 |
|------|----------|
| Web 配置面板无法访问 | 检查 `ADMIN_PORT` 配置；检查防火墙设置；检查服务是否启动 |
| 配置修改后不生效 | 检查是否为敏感配置（需重启服务）；查看服务日志 |
| 密码错误 | 检查 Web 面板密码是否正确设置 |
| 配置丢失 | 检查 `data/config.db` 是否存在；检查是否有备份文件 |

---

## 11. 会话相关

| 现象 | 优先检查 |
|------|----------|
| 私聊首次会推送多条引导消息 | 这是首次流程（建群卡片 + `/help` + `/panel`）；后续会按已绑定会话正常对话 |
| `/send <路径>` 报"文件不存在" | 确认路径正确且为绝对路径；Windows 路径用 `\` 或 `/` 均可 |
| `/send` 报"拒绝发送敏感文件" | 内置安全黑名单拦截了 .env、密钥等敏感文件 |
| 文件发送失败提示大小超限 | 飞书图片上限 10MB、文件上限 30MB；压缩后重试 |
| 会话绑定失败 | 检查 `ENABLE_MANUAL_SESSION_BIND` 配置；检查会话 ID 是否正确 |

---

## 12. 后台服务相关

| 现象 | 优先检查 |
|------|----------|
| 后台模式无法停止 | `logs/bridge.pid` 是否残留；使用 `node scripts/stop.mjs` 清理 |
| 服务启动失败 | 检查端口占用；查看 `logs/service.err` |
| 日志文件过大 | 定期清理 `logs/` 目录；配置日志轮转 |

---

## 13. 通用排查步骤

### 13.1 查看服务日志

```bash
# 查看标准输出日志
tail -f logs/service.log

# 查看错误日志
tail -f logs/service.err

# 查看可靠性审计日志
tail -f logs/reliability-audit.jsonl
```

### 13.2 检查配置

通过 Web 面板 `http://localhost:4098` 或 SQLite 数据库检查配置：

```bash
# 使用 SQLite 查看配置
sqlite3 data/config.db "SELECT * FROM config_store;"
```

### 13.3 重启服务

```bash
# 停止服务
node scripts/stop.mjs

# 启动服务
npm run start
```

### 13.4 检查网络

```bash
# 检查 OpenCode 是否可访问
curl http://localhost:4096

# 检查各平台 API 连通性
ping api.feishu.cn
ping discord.com
```

### 13.5 检查进程

```bash
# 查看 Bridge 进程
ps aux | grep opencode-bridge

# 查看 OpenCode 进程
ps aux | grep opencode
```

---

## 14. 获取帮助

如以上方法无法解决问题：

1. 查看详细日志，寻找错误信息
2. 访问 [GitHub Issues](https://github.com/HNGM-HP/opencode-bridge/issues) 搜索类似问题
3. 提交新 Issue，附上：
   - 问题描述
   - 相关日志
   - 配置信息（隐藏敏感数据）
   - 复现步骤
