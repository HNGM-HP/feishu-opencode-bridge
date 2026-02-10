# 飞书 × OpenCode 桥接服务

把 OpenCode（本地 `opencode serve`）接到飞书：在群聊里 @机器人对话、看流式输出；当 OpenCode 需要你确认权限或向你提问时，用飞书卡片完成交互。

如果你希望让 AI 代你部署：见 `AI_Deployment_Guide.md`。

## 能做什么

- 群聊对话：@机器人或回复机器人消息，消息会转发到 OpenCode 会话。
- 私聊引导：私聊机器人会发一张“创建会话群”卡片，点击后自动创建群聊并绑定 OpenCode 会话。
- 流式输出：通过输出缓冲定期更新飞书消息；如果检测到 reasoning/thinking，会自动切换为卡片展示，并支持“展开/折叠思考”。
- 交互式卡片：
  - `/panel`：控制面板（切换模型/Agent、停止、撤回）。
  - 权限确认：当 OpenCode 触发权限请求时，发送确认卡片（一次允许 / 始终允许 / 拒绝）。
  - 工具问答：当 OpenCode 触发 question 工具时，发送提问卡片，用户用文字回复完成单选/多选/自定义/跳过。
- `/undo`：回滚 OpenCode 上下文，并同步删除飞书端上一轮交互的相关消息；若撤回到“问题回答”，会递归撤回对应的“提问卡片”。
- 附件：支持飞书图片/文件消息，下载后按 OpenCode file part 发送（会做基础的 MIME/扩展名兜底）。

## 快速开始

### 前置条件

- Node.js（`package.json` 标注 `>= 20`；建议用 Node 20+ 运行）。
- OpenCode：本机已安装，并能启动服务。
- 飞书开放平台应用：启用机器人能力，配置事件订阅与权限。

### 启动

1) 启动 OpenCode：

```bash
opencode serve --port 4096
```

2) 配置环境变量：

```bash
cp .env.example .env
```

3) 启动桥接：

```bash
npm install
npm run dev
```

## 配置说明（.env）

以 `src/config.ts` 为准，常用字段如下：

```env
# 飞书应用配置
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# OpenCode 服务地址（可选）
OPENCODE_HOST=localhost
OPENCODE_PORT=4096

# 用户白名单（可选；留空表示不限制）
ALLOWED_USERS=ou_xxx,ou_yyy

# 默认模型
DEFAULT_PROVIDER=openai
DEFAULT_MODEL=gpt-5.2

# 权限白名单（自动放行，不发卡片）
TOOL_WHITELIST=Read,Glob,Grep,Task

# 输出刷新间隔（毫秒）
OUTPUT_UPDATE_INTERVAL=3000

# 附件最大体积（字节，可选）
ATTACHMENT_MAX_SIZE=52428800
```

说明：
- `TOOL_WHITELIST` 仅做字符串匹配；当权限事件的标识不是工具名而是 `permission`（例如 `external_directory`）时，白名单应按该标识配置。
- `.env.example` 中如果出现未被代码读取的字段（例如某些历史遗留的 timeout 参数），以 `src/` 中实际读取为准。

## 飞书后台配置

需要订阅的事件（至少）：
- `im.message.receive_v1`（收消息）
- `card.action.trigger`（卡片按钮回调）
- `im.message.recalled_v1`（用户撤回消息，用于触发 undo）
- `im.chat.member.user.deleted_v1`（成员退群清理）
- `im.chat.disbanded_v1`（群解散清理）

常用权限（至少）：
- `im:message`（收发消息、更新消息/卡片、撤回消息）
- `im:chat`（建群、拉人、解散、查询成员）
- `im:resource`（下载/上传附件资源）

## 使用方式

### 群聊

- 在群里 @机器人并发送内容。
- 或回复机器人消息继续对话。

### 私聊

- 私聊机器人会收到“创建会话群”卡片。
- 点击后会创建一个新的群聊，把你拉进群，并绑定一个新的 OpenCode session。

### 常用命令

| 命令 | 说明 |
|---|---|
| `/panel` | 打开控制面板卡片（切模型/Agent、停止、撤回） |
| `/model` | 查看当前模型（仅当前群聊） |
| `/model <provider:model>` | 切换模型（也支持只填 model 的简写） |
| `/agent` | 查看当前 Agent |
| `/agent <name>` | 切换 Agent |
| `/agent off` | 关闭 Agent（使用默认） |
| `/stop` | 中断当前会话执行 |
| `/undo` | 回滚上一轮交互（OpenCode + 飞书消息同步撤回） |
| `/session new` / `/clear` | 新建会话（重置上下文） |
| `/clear free session` | 扫描并清理空闲群聊（仅机器人独自在群内时解散并清理会话） |
| `/status` | 查看当前群绑定的 session 信息 |

## 关键技术点（以及为什么容易出错）

### 1) 权限请求与反馈（permission.asked）

OpenCode 的权限事件是通过 SSE 推送的：
- `permission.asked` 的 `properties.tool` 可能是对象（用于关联 tool call），并不等于“工具名”。真正表示权限类型/用途的字段通常是 `properties.permission`（例如 `external_directory`）。
- 权限回传接口 `/session/{sessionID}/permissions/{permissionID}` 的 body 需要使用枚举值：`response: "once" | "always" | "reject"`。

桥接端要同时解决两件事：
- 把权限事件正确路由回触发它的飞书群（依赖 `sessionID -> chatId` 的映射）。
- 把卡片按钮点击转换成 OpenCode 认可的回传 payload，否则会出现“飞书提示成功，但 OpenCode 实际无反应”。

### 2) 工具问答交互（question.asked）

当 OpenCode 通过 question 工具向用户提问时：
- 需要把问题结构渲染成飞书卡片（选项可能很多、还可能多选）。
- 用户的答案通常来自“文字回复”（A/1/自定义/跳过），桥接端要能解析并组装成 OpenCode 需要的 `answers: string[][]`。
- 回答完成后，还要把这次问答纳入撤回历史（/undo）以保持对话一致性。

### 3) 流式输出与卡片切换

- 飞书对更新频率和消息类型有约束：文本消息不能直接“原地变成卡片”，因此桥接端采用缓冲+定时更新，并在必要时删除旧消息重新发卡片。
- reasoning/thinking 需要和普通文本分流，同时提供“折叠/展开”以避免卡片过长。

### 4) /undo 的一致性

OpenCode 的 `revert` 是“回滚某条消息及其之后的上下文”，而飞书端撤回则是“删除具体消息”。要做到体验一致：
- 必须记录每轮交互在飞书侧发过哪些消息（含卡片/文本、可能不止一条）。
- 回滚时既要算出 OpenCode 该 revert 到哪条 messageID，也要把对应飞书消息删除干净。
- 问答场景下，回答和提问是两条交互（并且 OpenCode 内部 messageID 关联不直接暴露），需要做递归回滚兜底。

## 数据与状态

- 群聊与 OpenCode session 的绑定会持久化到 `.chat-sessions.json`（用于重启后继续路由权限/提问到正确群）。

## 排错

- 现象：飞书有权限卡片，点了“允许/拒绝”但 OpenCode 无反应
  - 检查桥接端日志是否打印了权限回传失败（会返回“权限响应失败”toast）。
  - 对照 OpenCode webui 行为：通常是 `POST /session/<id>/permissions/<permissionID>` 且 body 为 `{"response":"once|always|reject"}`。

- 现象：权限/提问卡片发不到群里
  - 说明 `sessionID -> chatId` 映射丢失或未建立；确认机器人是通过本桥接创建会话/群，且 `.chat-sessions.json` 未被清空。

- 现象：卡片更新失败（飞书返回特定错误码）
  - 常见原因是“消息类型不匹配”或卡片结构不允许原地更新；桥接端会尽量降级为重新发送。

## License

MIT
