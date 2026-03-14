# 工作目录与项目策略指南（v2.9.0）

本文档说明桥接服务当前的工作目录策略、命令入口和安全约束。

## 1. 设计目标

- 让用户在聊天侧安全地选择工作目录，不破坏宿主机边界。
- 保持 Feishu 与 Discord 行为一致：目录可配置、会话可继承、权限可追踪。
- 避免“目录切换后任务卡住”这类实例错位问题。

## 2. 目录优先级

创建或切换会话时，目录来源按以下优先级决策：

1. 显式输入目录（命令参数 / 卡片输入）
2. 项目别名（`PROJECT_ALIASES`）
3. 群默认目录（会话绑定存储）
4. 全局默认目录（`DEFAULT_WORK_DIRECTORY`）
5. OpenCode 服务端默认目录

对应实现：`src/utils/directory-policy.ts`。

## 3. 安全规则

目录决策会经过完整校验流程：

- 路径格式和长度检查
- 危险路径拦截
- 白名单检查（`ALLOWED_DIRECTORIES`）
- 存在性与可访问性检查
- realpath 解析与二次白名单检查
- Git 根目录归一化与复检

未通过任一检查会返回用户友好提示，并在服务端日志记录详细原因。

## 4. /create_chat 的目录来源（当前行为）

Feishu 私聊 `create_chat` 面板中的“工作项目（可选）”会综合三类来源：

- `DEFAULT_WORK_DIRECTORY`
- `ALLOWED_DIRECTORIES`
- 已存在会话目录（历史会话与绑定会话）

并叠加 `PROJECT_ALIASES` 别名结果。

即使没有历史项目，下拉也会保留“跟随默认项目”选项，避免交互入口消失。

## 5. 平台命令入口

### 5.1 Feishu

- `/project list`
- `/project default`
- `/project default set <路径|别名>`
- `/project default clear`
- `/session new <路径|别名>`
- `/create_chat`（卡片方式选择会话和目录）

### 5.2 Discord

- `///workdir`
- `///workdir <路径|别名>`
- `///workdir clear`
- `///new [名称] [--dir 路径|别名]`
- `///new-channel [名称] [--dir 路径|别名]`
- `///create_chat`

## 6. 环境变量建议

最小建议配置：

```env
ALLOWED_DIRECTORIES=/path/to/projects,/path/to/repos
DEFAULT_WORK_DIRECTORY=/path/to/projects/default
PROJECT_ALIASES={"bridge":"/path/to/feishu-opencode-bridge"}
GIT_ROOT_NORMALIZATION=true
```

说明：

- 未配置 `ALLOWED_DIRECTORIES` 时，用户自定义目录能力默认受限。
- `PROJECT_ALIASES` 建议只放常用工程，避免面板选项过多。

## 7. 权限与目录一致性

权限回传不再只依赖 `sessionId`，还会附带目录候选：

- 优先当前会话目录（`resolvedDirectory/defaultDirectory`）
- 再尝试已知目录列表
- 最后回退默认目录实例

这样可减少目录切换后的权限确认假死。

## 8. 常见问题

### Q1: 为什么设置了目录却仍提示不允许？

- 检查是否在 `ALLOWED_DIRECTORIES` 范围内。
- 检查 realpath 后是否仍在白名单内（符号链接场景常见）。

### Q2: 为什么 /create_chat 看不到历史项目？

- 目录可能被白名单过滤。
- 目录不存在或无读取权限会被自动剔除。

### Q3: 目录切换后权限看起来“允许了”但任务没继续？

- 检查日志中权限回传是否命中目录候选。
- 确认 OpenCode 实例和当前会话目录一致。

## 9. 维护建议

- 目录相关改动必须补测试（目录策略 + 面板选项 + 权限回传）。
- 发布前至少执行 `npm run build` 和 `npm test`。
- 目录策略变更要同步更新 `.env.example` 与 README 环境变量章节。
