# 飞书后台配置指南

## 事件订阅

建议使用长连接模式（WebSocket 事件）。

| 事件 | 必需 | 用途 |
|---|---|---|
| `im.message.receive_v1` | 是 | 接收群聊/私聊消息 |
| `im.message.recalled_v1` | 是 | 用户撤回触发 `/undo` 回滚 |
| `im.chat.member.user.deleted_v1` | 是 | 成员退群后触发生命周期清理 |
| `im.chat.disbanded_v1` | 是 | 群解散后清理本地会话映射 |
| `card.action.trigger` | 是 | 处理控制面板、权限确认、提问卡片回调 |
| `im.message.message_read_v1` | 否 | 已读回执兼容（可不开启） |

## 应用权限

按实际调用接口梳理：

| 能力分组 | 代码中调用的接口 | 用途 |
|---|---|---|
| 消息读写与撤回（`im:message`） | `im:message.p2p_msg:readonly` / `im:message.group_at_msg:readonly` / `im:message.group_msg` / `im:message.reactions:read` / `im:message.reactions:write_only` | 发送文本/卡片、流式更新卡片、撤回消息 |
| 群与成员管理（`im:chat`） | `im:chat.members:read` / `im:chat.members:write_only` | 私聊建群、拉人进群、查群成员、自动清理无效群 |
| 消息资源下载（`im:resource`） | `im.messageResource.get` | 下载图片/文件附件并转发给 OpenCode |

**注意**：飞书后台不同版本的权限名称可能略有差异，按上表接口能力逐项对齐即可；若只需文本对话且不处理附件，可暂不开启 `im:resource`。

### 批量导入权限配置

可以复制下方参数保存至 `acc.json`，然后在飞书**开发者后台** → **权限管理** → **批量导入/导出权限**：

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
