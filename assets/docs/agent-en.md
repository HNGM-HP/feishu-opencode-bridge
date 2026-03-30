# Agent (Role) Usage Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

Agents (also called Roles) allow you to customize the AI assistant's behavior and expertise for specific tasks.

---

## 2. View and Switch Agent

### Web Panel (Recommended)

Use `/panel` command to visually switch agents - takes effect immediately in current session.

### Commands

| Command | Description |
|---------|-------------|
| `/agent` | View current Agent |
| `/agent <name>` | Switch to specified Agent |
| `/agent off` | Return to default Agent |

---

## 3. Custom Agent Creation

### Natural Language Format

Create agents using natural language:

```text
创建角色 名称=Travel Assistant; 描述=Expert at travel planning; 类型=primary; 工具=webfetch; 提示词=Ask budget and time first, then provide three options
```

### Slash Command Format

Create agents using structured command:

```text
/role create name=Code Reviewer; description=Focus on maintainability and security; type=subagent; tools=read,grep; prompt=List risks first, then give minimal change suggestions
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `名称` / `name` | Yes | Agent name |
| `描述` / `description` | No | Agent description |
| `类型` / `type` | No | `primary` or `subagent` |
| `工具` / `tools` | No | Comma-separated tool list |
| `提示词` / `prompt` | No | Custom instructions |

---

## 4. Agent Types

### Primary Agent

- Main agent for the conversation
- Has full access to tools
- Can delegate to subagents

### Subagent

- Specialized assistant for specific tasks
- Limited tool access
- Works under primary agent supervision

---

## 5. Built-in Agents

OpenCode comes with default agents:

| Agent | Description |
|-------|-------------|
| `general` | General-purpose assistant |
| `companion` | Conversational companion |

You can switch between these or create custom agents.

---

## 6. Configuration Reminder

If `/panel` does not immediately show the new role after configuration:

1. Restart OpenCode service
2. Or wait for configuration to take effect

---

## 7. Related Documentation

- [Commands Reference](commands-en.md) - Command list
- [Configuration Center](environment-en.md) - Environment variables
