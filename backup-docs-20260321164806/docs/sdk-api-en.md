# OpenCode SDK Integration Guide (Bridge Side, v2.9.3-beta)

This document is not a comprehensive SDK manual, but rather the actual encapsulation and call conventions used in `src/opencode/client.ts` of this project.

## 1. Integration Principles

- Bridge stability first: unified error handling, unified logging, unified retry strategy.
- Sessions, messages, permissions, and questions are all exposed through `OpencodeClientWrapper`; do not call underlying SDK directly at business layer.
- Platform layer only cares about business results, not SDK details.

## 2. Key Types

### 2.1 Permission Event

```ts
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

### 2.2 Permission Response Options

```ts
interface PermissionResponseOptions {
  directory?: string;
  fallbackDirectories?: string[];
}
```

Purpose: Directory switch permission response prioritizes hitting current directory instance, then falls back by candidate directory.

## 3. Encapsulated Methods Summary

### 3.1 Connection & Events

- `connect()`: Initialize SDK client and verify availability.
- `disconnect()`: Close event stream and reconnection timer.
- `startEventListener()`: Start global event subscription.
- `_createDirectoryEventStream()`: Directory-level event stream (established on demand).

### 3.2 Sessions & Projects

- `listProjects(directory?)`
- `listSessions(directory?)`
- `listSessionsAcrossProjects()`
- `findSessionAcrossProjects(sessionId)`
- `createSession(title?, directory?)`
- `updateSession(sessionId, title)`
- `deleteSession(sessionId, directory?)`
- `getSessionById(sessionId)`
- `getSessionMessages(sessionId)`

### 3.3 Messages & Commands

- `sendMessage(sessionId, text, options)`
- `sendMessageAsync(sessionId, text, options)`
- `sendMessageParts(sessionId, parts, options)`
- `sendMessagePartsAsync(sessionId, parts, options)`
- `sendCommand(sessionId, command, args?)`
- `sendShellCommand(sessionId, command, options)`

### 3.4 Permissions & Questions

- `respondToPermission(sessionId, permissionId, allow, remember?, options?)`
- `replyQuestion(sessionId, questionId, answers)`
- `rejectQuestion(sessionId, questionId)`

### 3.5 Session Control

- `abortSession(sessionId)`
- `revertMessage(sessionId, messageId)`
- `summarizeSession(sessionId, providerId, modelId)`

### 3.6 Configuration & Metadata

- `getProviders()`
- `getConfig()`
- `updateConfig(body)`
- `getAgents()`

## 4. Permission Response Directory Strategy (Key Point)

`respondToPermission(...)` current implementation has the following behavior:

1. Allows passing `directory` and `fallbackDirectories`.
2. Tries each candidate directory:
   - Returns success on hit;
   - Records failure in log and continues to next candidate;
3. Finally falls back to default directory instance (without `directory` query).

This significantly reduces the problem of "switching working directory, permission allow log printed, but task still stuck".

## 5. Event Distribution Conventions

Bridge side consumes SDK events through `OpenCodeEventHub`; key events include:

- `permissionRequest`
- `questionAsked`
- `messagePartUpdated`
- `messageUpdated`
- `sessionStatus`
- `sessionIdle`
- `sessionError`

Recommended practices:

- Only do routing and state changes at event layer; do not do platform UI assembly.
- UI-related rendering is handled by Feishu/Discord rendering layers separately.

## 6. Common Call Templates

### 6.1 Send Message (with Directory and Model)

```ts
await opencodeClient.sendMessage(sessionId, prompt, {
  providerId,
  modelId,
  directory,
  agent,
  variant,
});
```

### 6.2 Response Permission (Directory Aware)

```ts
await opencodeClient.respondToPermission(sessionId, permissionId, true, false, {
  directory: resolvedDirectory,
  fallbackDirectories: knownDirectories,
});
```

### 6.3 Reply Question

```ts
await opencodeClient.replyQuestion(sessionId, requestId, answers);
```

## 7. Troubleshooting Checklist

- 401/403: First verify `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`.
- Session not found: Check if `sessionId` is cross-directory, try `findSessionAcrossProjects`.
- Permission stuck: Check if permission response carries directory candidates.
- Streaming no output: Check if event listener is started, if OutputBuffer triggers updates.

## 8. Upgrade Recommendations

- Before upgrading SDK, run full test suite and observe `PermissionRequestEvent` field compatibility.
- Keep bridge encapsulation layer stable; avoid business layer directly coupling to SDK raw fields.
- Any permission/directory related changes require regression tests.
