# Agent (Role) Usage Guide

## 1) View and Switch

- Recommended to use `/panel` to visually switch roles (takes effect immediately in current group).
- Alternatively use commands: `/agent` (view current), `/agent <name>` (switch), `/agent off` (return to default).

## 2) Custom Agent

Supports creating and switching directly via natural language:

```text
Create Role name=Travel Assistant; description=Expert at travel planning; type=primary; tools=webfetch; prompt=Ask budget and time first, then provide three options
```

Also supports slash form:

```text
/role create name=Code Reviewer; description=Focus on maintainability and security; type=subagent; tools=read,grep; prompt=List risks first, then give minimal change suggestions
```

**Type** supports `primary/subagent`.

## 3) Configuring Agent (Reminder)

If `/panel` does not immediately show the new role after configuration, restart OpenCode.
