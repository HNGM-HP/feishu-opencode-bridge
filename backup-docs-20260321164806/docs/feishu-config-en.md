# Feishu Backend Configuration Guide

## Event Subscriptions

Recommended to use long connection mode (WebSocket events).

| Event | Required | Purpose |
|---|---|---|
| `im.message.receive_v1` | Yes | Receive group/private chat messages |
| `im.message.recalled_v1` | Yes | User recall triggers `/undo` rollback |
| `im.chat.member.user.deleted_v1` | Yes | Member leave group triggers lifecycle cleanup |
| `im.chat.disbanded_v1` | Yes | Group dismiss triggers local session mapping cleanup |
| `card.action.trigger` | Yes | Handle control panel, permission confirmation, question card callbacks |
| `im.message.message_read_v1` | No | Read receipt compatibility (can be disabled) |

## Application Permissions

Organized by actual API calls:

| Capability Group | APIs Called in Code | Purpose |
|---|---|---|
| Message Read/Write & Recall (`im:message`) | `im:message.p2p_msg:readonly` / `im:message.group_at_msg:readonly` / `im:message.group_msg` / `im:message.reactions:read` / `im:message.reactions:write_only` | Send text/cards, streaming card updates, recall messages |
| Group & Member Management (`im:chat`) | `im:chat.members:read` / `im:chat.members:write_only` | Private chat group creation, invite members, check group members, auto cleanup invalid groups |
| Message Resource Download (`im:resource`) | `im.messageResource.get` | Download image/file attachments and forward to OpenCode |

**Note**: Permission names may vary slightly in different Feishu backend versions; align with the API capabilities in the table above. If only text conversation is needed without attachment handling, `im:resource` can be temporarily disabled.

### Batch Import Permission Configuration

Copy the following parameters to `acc.json`, then in Feishu **Developer Backend** → **Permission Management** → **Batch Import/Export Permissions**:

```json
{
  "scopes": {
    "tenant": [
      "im:message.p2p_msg:readonly",
      "im:chat",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:resource"
    ],
    "user": []
  }
}
```
