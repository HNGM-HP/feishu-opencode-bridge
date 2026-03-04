# 2026-03-04 Task: Discord 会话绑定与路由接线（T13）

## 实现要点

### 平台感知会话绑定 API

新增以下平台感知方法到 `ChatSessionStore`：

| 方法名 | 功能 | 参数 | 返回值 |
|--------|------|------|--------|
| `getSessionIdByConversation(platform, conversationId)` | 获取平台会话 ID | `platform: string`, `conversationId: string` | `string \| null` |
| `getSessionByConversation(platform, conversationId)` | 获取平台会话数据 | `platform: string`, `conversationId: string` | `ChatSessionData \| undefined` |
| `setSessionByConversation(platform, conversationId, sessionId, creatorId, title?, options?)` | 设置平台会话绑定 | `platform`, `conversationId`, `sessionId`, `creatorId`, `title?`, `options?` | `void` |
| `getConversationBySessionId(sessionId)` | 反向查找：sessionId → {platform, conversationId} | `sessionId: string` | `{ platform: string; conversationId: string } \| null` |

### Discord 适配器集成

`DiscordAdapter` 新增方法：

| 方法名 | 功能 |
|--------|------|
| `bindSession(conversationId, sessionId, creatorId)` | 绑定 Discord 会话到 OpenCode session |
| `getSessionId(conversationId)` | 获取 Discord 会话的 OpenCode session ID |

### 命名空间键隔离

- **Feishu**: `feishu:{chatId}` - 使用 `setSession()` 自动映射
- **Discord**: `discord:{channelId}` - 使用 `setSessionByConversation('discord', channelId, ...)`

**关键保证**：
- 相同 `chatId`/`channelId` 值在不同平台不会冲突
- `feishu:channel_abc` 和 `discord:channel_abc` 存储为不同 key
- `getChatId(sessionId)` 反向查找时自动提取 `platform` 和 `conversationId`

### 向后兼容性

1. **旧版方法保留**：`getSessionId(chatId)`, `setSession(chatId, ...)` 等继续工作
2. **Read priority**：优先读取命名空间键，回退到 legacy key
3. **Write policy**：新写入始终使用命名空间键
4. **API layering**：
   - 新平台适配器 → `setSessionByConversation()` / `getSessionIdByConversation()`
   - Feishu legacy 调用方 → `setSession()` / `getSessionId()`（内部转为 `feishu:{chatId}`）

## 测试覆盖

### 1. Discord 会话绑定基本功能
```typescript
it('应该支持 Discord 会话绑定（discord:channelId）', () => {
  chatSessionStore.setSessionByConversation('discord', channelId, sessionId, creatorId);
  expect(chatSessionStore.getSessionIdByConversation('discord', channelId)).toBe(sessionId);
});
```

### 2. 平台隔离（同 raw ID 不冲突）
```typescript
it('应该独立存储 Discord 和 Feishu 会话（相同 raw ID 不冲突）', () => {
  chatSessionStore.setSession(rawId, feishuSessionId, ...);
  chatSessionStore.setSessionByConversation('discord', rawId, discordSessionId, ...);
  
  expect(chatSessionStore.getSessionId(rawId)).toBe(feishuSessionId);  // Feishu
  expect(chatSessionStore.getSessionIdByConversation('discord', rawId)).toBe(discordSessionId);  // Discord
});
```

### 3. 反向查找平台信息
```typescript
it('getConversationBySessionId 应该正确返回 platform 和 conversationId', () => {
  chatSessionStore.setSessionByConversation('discord', channelId, sessionId, creatorId);
  const conversation = chatSessionStore.getConversationBySessionId(sessionId);
  expect(conversation).toEqual({ platform: 'discord', conversationId: channelId });
});
```

### 4. Legacy 兼容性回归
- 9个原有测试全部通过（无破坏性变更）
- `chatSession.test.ts` 现有49测试全部通过

## 验证结果

| 项目 | 状态 |
|------|------|
| `npm run build` | ✅ 通过（0 errors） |
| `npx vitest run` | ✅ 54 tests passed |
| LSP diagnostics | ✅ clean（chat-session.ts, discord-adapter.ts） |

## 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/store/chat-session.ts` | modified | 新增4 platform-aware API，重写285行（原466行 → 新628行） |
| `src/platform/adapters/discord-adapter.ts` | modified | 新增 `bindSession()`, `getSessionId()`，导入 `chatSessionStore` |
| `tests/chat-session.test.ts` | modified | 新增4 Discord platform-aware 测试用例（共14 tests） |

## 使用示例

### Discord 适配器绑定会话
```typescript
// 当 Discord 事件到达时
const channelId = event.conversationId; // e.g., "1234567890"
const sessionId = event.sessionId;       // OpenCode session ID

discordAdapter.bindSession(channelId, sessionId, 'discord_bot');
// internally calls: setSessionByConversation('discord', channelId, sessionId, 'discord_bot')
```

### 路由器查询会话平台
```typescript
// 当需要根据 OpenCode session ID 确定发送平台时
const sessionId = event.sessionId;
const conversation = chatSessionStore.getConversationBySessionId(sessionId);

if (conversation) {
  if (conversation.platform === 'discord') {
    // 发送到 Discord
    await discordAdapter.getSender().sendText(conversation.conversationId, text);
  } else if (conversation.platform === 'feishu') {
    // 发送到 Feishu
    await feishuAdapter.getSender().sendText(conversation.conversationId, text);
  }
}
```

## 后续规划

- **T16 端到端联调**：端到端验证 Discord 入站消息流
- **完整 Discord ingress**：实现 Discord gateway 连接和消息接收
- **Output dispatch**：按 `platform` 分发 OpenCode 输出到对应平台
