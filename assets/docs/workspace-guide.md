# 工作区功能实现指南

## 一、需求概述

在 OpenCode 桥接项目中实现工作区管理功能，支持以下命令：

- `/workspace list` 或 `/ws list` - 列出所有工作区
- `/workspace switch <name>` 或 `/ws switch <name>` - 切换到指定工作区
- `/workspace create <path>` 或 `/ws create <path>` - 创建新工作区
- `/workspace current` 或 `/ws current` - 显示当前工作区

## 二、架构设计

### 1. 核心组件

```
用户发送 /workspace 命令
    │
    ▼
commands/parser.ts  →  解析为 workspace 命令
    │
    ▼
handlers/command.ts  →  handleWorkspace() 处理子命令
    ├── list    → opencodeClient.listProjects() → 格式化输出
    ├── switch  → 查找 project → workspaceStore.set() → 新建会话(带 directory)
    ├── create  → fs.mkdir() → 新建会话(带 directory) → workspaceStore.set()
    └── current → workspaceStore.get() 或 project.current()
```

### 2. 新增/修改文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/store/workspace.ts` | 新建 | 用户/群聊的工作区偏好持久化存储 |
| `src/commands/parser.ts` | 修改 | 添加 `workspace` 命令类型和解析逻辑 |
| `src/handlers/command.ts` | 修改 | 添加 `handleWorkspace()` 处理全部子命令 |
| `src/opencode/client.ts` | 修改 | 添加 `listProjects()`/`getCurrentProject()` + `createSession()` 支持 directory 参数 |
| `src/handlers/group.ts` | 修改 | 创建会话时从 workspaceStore 读取 directory |
| `src/handlers/p2p.ts` | 修改 | 同上 |

## 三、详细实现方案

### 1. 工作区存储 (`src/store/workspace.ts`)

```typescript
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface WorkspacePreference {
    chatId: string;
    projectId?: string;
    worktree?: string;
    createdAt: number;
}

export class WorkspaceStore {
    private filePath: string;
    private data: Map<string, WorkspacePreference> = new Map();

    constructor() {
        this.filePath = join(process.cwd(), '.workspace-preferences.json');
        this.load();
    }

    private load(): void {
        if (existsSync(this.filePath)) {
            const content = JSON.parse(readFileSync(this.filePath, 'utf-8'));
            this.data = new Map(Object.entries(content));
        }
    }

    private save(): void {
        const obj = Object.fromEntries(this.data);
        writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
    }

    get(chatId: string): WorkspacePreference | undefined {
        return this.data.get(chatId);
    }

    set(chatId: string, projectId: string, worktree: string): void {
        this.data.set(chatId, {
            chatId,
            projectId,
            worktree,
            createdAt: Date.now()
        });
        this.save();
    }

    remove(chatId: string): void {
        this.data.delete(chatId);
        this.save();
    }

    getDirectory(chatId: string): string | undefined {
        const pref = this.get(chatId);
        return pref?.worktree;
    }
}

export const workspaceStore = new WorkspaceStore();
```

### 2. 命令解析 (`src/commands/parser.ts`)

```typescript
// 在 CommandType 中添加
'workspace' as const,

// 在 parseCommand 函数中添加
case 'workspace': {
    const parts = content.split(/\s+/);
    if (parts.length === 1) {
        return { type: 'workspace', subCommand: 'current' };
    }
    const subCommand = parts[1];
    const args = parts.slice(2).join(' ');
    
    switch (subCommand) {
        case 'list':
            return { type: 'workspace', subCommand: 'list' };
        case 'switch':
            return { type: 'workspace', subCommand: 'switch', args };
        case 'create':
            return { type: 'workspace', subCommand: 'create', args };
        case 'current':
            return { type: 'workspace', subCommand: 'current' };
        default:
            return { type: 'workspace', subCommand: 'unknown' };
    }
}
```

### 3. 命令处理 (`src/handlers/command.ts`)

```typescript
async handleWorkspace(command: ParsedCommand, context: CommandContext) {
    const { chatId, messageId, senderId, chatType } = context;
    
    switch (command.subCommand) {
        case 'list':
            return await this.handleWorkspaceList(chatId, messageId);
        case 'switch':
            return await this.handleWorkspaceSwitch(chatId, messageId, command.args);
        case 'create':
            return await this.handleWorkspaceCreate(chatId, messageId, command.args);
        case 'current':
            return await this.handleWorkspaceCurrent(chatId, messageId);
        default:
            return await this.reply(chatId, messageId, '未知的工作区命令，请使用 /workspace help 查看帮助');
    }
}

private async handleWorkspaceList(chatId: string, messageId: string) {
    const projects = await this.opencodeClient.listProjects();
    if (projects.length === 0) {
        return await this.reply(chatId, messageId, '没有找到任何工作区');
    }

    const currentPref = workspaceStore.get(chatId);
    const currentProject = currentPref?.projectId;
    
    const list = projects.map((proj, idx) => {
        const isCurrent = proj.id === currentProject;
        return `${idx + 1}. ${proj.worktree} ${isCurrent ? '(当前)' : ''}`;
    }).join('\n');

    return await this.reply(chatId, messageId, `工作区列表：\n${list}`);
}

private async handleWorkspaceSwitch(chatId: string, messageId: string, args: string) {
    const projects = await this.opencodeClient.listProjects();
    let targetProject: Project | undefined;

    // 支持序号、名称或路径匹配
    if (/^\d+$/.test(args)) {
        const index = parseInt(args) - 1;
        targetProject = projects[index];
    } else {
        targetProject = projects.find(p => 
            p.worktree === args || p.id === args || p.worktree.includes(args)
        );
    }

    if (!targetProject) {
        return await this.reply(chatId, messageId, `未找到工作区: ${args}`);
    }

    // 创建新会话
    const session = await this.opencodeClient.createSession({
        query: { directory: targetProject.worktree },
        body: { title: `工作区: ${targetProject.worktree}` }
    });

    // 更新工作区偏好
    workspaceStore.set(chatId, targetProject.id, targetProject.worktree);

    // 更新群聊会话绑定
    const chatSession = chatSessionStore.getSessionId(chatId);
    if (chatSession) {
        await this.opencodeClient.deleteSession(chatSession);
    }
    chatSessionStore.setSession(chatId, session.id, senderId, `工作区: ${targetProject.worktree}`);

    return await this.reply(chatId, messageId, `已切换到工作区: ${targetProject.worktree}`);
}

private async handleWorkspaceCreate(chatId: string, messageId: string, args: string) {
    const basePath = process.env.WORKSPACE_ROOT || process.cwd();
    const fullPath = join(basePath, args);
    
    // 验证路径安全
    if (!fullPath.startsWith(basePath)) {
        return await this.reply(chatId, messageId, '路径不安全，只能在指定工作区根目录下创建');
    }

    // 创建目录
    try {
        mkdirSync(fullPath, { recursive: true });
    } catch (error) {
        return await this.reply(chatId, messageId, `创建目录失败: ${error.message}`);
    }

    // 创建会话触发 OpenCode 注册
    const session = await this.opencodeClient.createSession({
        query: { directory: fullPath },
        body: { title: `工作区: ${args}` }
    });

    // 更新工作区偏好
    workspaceStore.set(chatId, session.projectID, fullPath);

    return await this.reply(chatId, messageId, `工作区创建成功: ${fullPath}`);
}

private async handleWorkspaceCurrent(chatId: string, messageId: string) {
    const pref = workspaceStore.get(chatId);
    if (!pref) {
        return await this.reply(chatId, messageId, '未设置工作区偏好');
    }

    const project = await this.opencodeClient.getCurrentProject({
        query: { directory: pref.worktree }
    });

    return await this.reply(chatId, messageId, `当前工作区: ${project.worktree}`);
}
```

### 4. OpenCode 客户端增强 (`src/opencode/client.ts`)

```typescript
// 添加封装方法
async listProjects(): Promise<Project[]> {
    return this.project.list();
}

async getCurrentProject(): Promise<Project> {
    return this.project.current();
}

async createSession(title?: string, directory?: string): Promise<Session> {
    return this.session.create({
        body: { title },
        query: { directory }
    });
}
```

### 5. 消息处理器集成 (`src/handlers/group.ts` 和 `p2p.ts`)

```typescript
// 在创建新会话时添加
const directory = workspaceStore.getDirectory(chatId);
const session = await opencodeClient.createSession({
    title: `会话 ${Date.now()}`,
    directory
});
```

## 四、风险与注意事项

### 1. `session.create({ query: { directory } })` 是否会自动注册 Project

**风险**：这是未验证的假设。如果不行，`/workspace create` 功能会降级为仅创建文件夹但不出现在工作区列表中。

**验证方案**：
- 先实现功能，测试 `/workspace create` 后调用 `listProjects()` 是否能看到新创建的目录
- 如果看不到，需要寻找其他方式触发 Project 注册

### 2. 路径安全

**风险**：用户可能创建到系统敏感目录。

**解决方案**：
- 添加 `WORKSPACE_ROOT` 环境变量作为基础目录
- 验证所有路径都在该目录下
- 拒绝创建到敏感路径（如 `/etc`, `/usr` 等）

### 3. 并发安全

**风险**：多个群聊同时切换工作区时，store 的读写需要是安全的。

**解决方案**：
- 当前的 JSON 文件持久化方案已有同步写入机制
- `WorkspaceStore` 使用 Map 和同步文件操作，确保线程安全

### 4. 工作区与现有会话的关系

**策略**：切换工作区时创建新会话，旧会话保留不动。

**优势**：
- 用户可以同时使用多个工作区
- 不会丢失历史会话
- 符合用户预期

## 五、测试方案

1. **功能测试**：
   - `/workspace list` - 验证列表显示正确
   - `/workspace switch` - 验证切换成功，新会话创建
   - `/workspace create` - 验证目录创建和会话创建
   - `/workspace current` - 验证当前工作区显示正确

2. **边界测试**：
   - 无效的工作区名称
   - 路径安全验证
   - 并发切换测试

3. **集成测试**：
   - 工作区切换后，消息是否正确发送到新会话
   - 流式输出是否正常工作
   - 权限请求是否正确处理

## 六、部署注意事项

1. **环境变量**：
   - 添加 `WORKSPACE_ROOT` 环境变量指定工作区根目录
   - 确保服务有权限创建目录

2. **权限配置**：
   - 考虑添加工作区管理权限
   - 防止普通用户随意创建工作区

3. **数据迁移**：
   - 如果已有 `.session-directories.json`，需要考虑迁移策略

## 七、后续优化方向

1. **工作区别名**：支持为工作区设置别名
2. **工作区共享**：支持多个群聊共享同一个工作区
3. **工作区删除**：支持删除不再需要的工作区
4. **工作区备份**：支持工作区数据备份和恢复
5. **工作区模板**：支持基于模板创建工作区

这个实现方案充分利用了 OpenCode SDK 现有的 `project` 和 `session` API，同时保持了与现有架构的一致性。通过最小修改实现工作区管理功能，降低了集成风险。