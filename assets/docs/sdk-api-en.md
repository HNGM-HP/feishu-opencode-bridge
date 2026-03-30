# OpenCode SDK Integration Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Integration Principles

| Principle | Description |
|-----------|-------------|
| **Bridge stability first** | Unified error handling, logging, and retry strategy |
| **Unified interface** | Sessions, messages, permissions, and questions all exposed through `OpencodeClientWrapper` |
| **Abstraction** | Business layer never calls underlying SDK directly |

---

## 2. Key Types

### Permission Event

```typescript
interface PermissionRequestEvent {
  sessionId: string;
  permissionId: string;
  tool: string;
  description: string;
  risk?: string;
  parentSessionId?: string;
  relatedSessionId?: string;
  messageId?: string;
  callId?: string;
}
```

### Permission Response Options

```typescript
interface PermissionResponseOptions {
  directory?: string;
  fallbackDirectories?: string[];
}
```

Used for directory-aware permission responses with fallback candidates.

---

## 3. API Overview

### Connection & Events

| Method | Description |
|--------|-------------|
| `connect()` | Initialize SDK client and verify availability |
| `disconnect()` | Close event stream and reconnect timer |
| `startEventListener()` | Start global event subscription |

### Sessions & Projects

| Method | Description |
|--------|-------------|
| `listProjects(directory?)` | List projects |
| `listSessions(directory?)` | List sessions |
| `createSession(title?, directory?)` | Create new session |
| `updateSession(sessionId, title)` | Update session title |
| `deleteSession(sessionId, directory?)` | Delete session |
| `getSessionById(sessionId)` | Get session by ID |

### Messages & Commands

| Method | Description |
|--------|-------------|
| `sendMessage(sessionId, text, options)` | Send message |
| `sendMessageAsync(sessionId, text, options)` | Send message (async) |
| `sendCommand(sessionId, command, args?)` | Send command |
| `sendShellCommand(sessionId, command, options)` | Send shell command |

### Permissions & Questions

| Method | Description |
|--------|-------------|
| `respondToPermission(sessionId, permissionId, allow, remember?, options?)` | Respond to permission |
| `replyQuestion(sessionId, questionId, answers)` | Reply to question |
| `rejectQuestion(sessionId, questionId)` | Reject question |

### Session Control

| Method | Description |
|--------|-------------|
| `abortSession(sessionId)` | Abort session |
| `revertMessage(sessionId, messageId)` | Revert message |
| `summarizeSession(sessionId, providerId, modelId)` | Summarize session |

---

## 4. Directory-Aware Permission Response

The `respondToPermission()` method supports directory-aware responses:

```typescript
await opencodeClient.respondToPermission(sessionId, permissionId, true, false, {
  directory: resolvedDirectory,
  fallbackDirectories: knownDirectories,
});
```

### Behavior

1. Try each directory candidate in order
2. Return success on first hit
3. Log failure and continue to next candidate
4. Finally fallback to default directory instance

This significantly reduces "permission allowed in logs but task still stuck" issues.

---

## 5. Event Dispatch

Events are consumed through `OpenCodeEventHub`:

| Event | Description |
|-------|-------------|
| `permissionRequest` | Permission request received |
| `questionAsked` | Question received |
| `messagePartUpdated` | Message part updated |
| `messageUpdated` | Message updated |
| `sessionStatus` | Session status changed |
| `sessionIdle` | Session became idle |
| `sessionError` | Session error occurred |

### Best Practices

- Only route and update state in event layer
- Don't assemble platform UI in event handlers
- Let each platform's renderer handle UI

---

## 6. Common Patterns

### Send Message with Options

```typescript
await opencodeClient.sendMessage(sessionId, prompt, {
  providerId,
  modelId,
  directory,
  agent,
  variant,
});
```

### Respond to Permission with Directory

```typescript
await opencodeClient.respondToPermission(sessionId, permissionId, true, false, {
  directory: resolvedDirectory,
  fallbackDirectories: knownDirectories,
});
```

### Reply to Question

```typescript
await opencodeClient.replyQuestion(sessionId, requestId, answers);
```

---

## 7. Troubleshooting

| Issue | Check |
|-------|-------|
| 401/403 | Verify `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD` |
| Session not found | Check if `sessionId` crosses directories; try `findSessionAcrossProjects` |
| Permission stuck | Check if permission response includes directory candidates |
| No streaming output | Check if event listener started; check OutputBuffer triggers |

---

## 8. Upgrade Notes

- Run full tests before SDK upgrade
- Monitor `PermissionRequestEvent` field compatibility
- Keep bridge wrapper stable
- Avoid business layer coupling to raw SDK fields
- Add regression tests for any permission/directory changes

---

## 9. Related Documentation

- [Architecture](architecture-en.md) - OpenCode integration layer
- [Implementation Details](implementation-en.md) - Key implementation patterns
- [Troubleshooting Guide](troubleshooting-en.md) - Common SDK issues
