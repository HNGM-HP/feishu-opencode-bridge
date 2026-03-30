# Implementation Details

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Permission Request Response

### Key Points

- In `permission.asked` event, `tool` may not be a string tool name; actual whitelist matching may fall on the `permission` field
- The response interface requires `response` to be `once | always | reject`, not `allow | deny`

---

## 2. Question Tool Interaction

### Flow

1. Questions are rendered as Feishu cards
2. Answers are parsed from user text replies
3. After parsing, responses are sent back as `answers: string[][]` required by OpenCode
4. Answers are included in undo history for consistency

---

## 3. Streaming and Thinking Cards

### Behavior

- Text and thinking content are written to output buffer separately
- Card mode switches automatically when thinking content appears
- Cards support expand/collapse for thinking content
- Final state retains completion status

---

## 4. `/undo` Consistency

### Requirements

- Requires deleting platform-side message AND executing `revert` on OpenCode simultaneously
- Q&A scenarios may involve multiple associated messages
- Uses recursive rollback as fallback for complex scenarios

---

## 5. Private Chat Group Creation Card Interaction

### Behavior

- Dropdown selection action only records session selection
- Does not depend on card redraw
- Behavior consistent with `/panel` dropdown interaction
- Group creation and binding are executed only when clicking "Create Group" button
- Avoids misbinding due to card state synchronization issues

---

## 6. `/clear free session` Behavior

### Implementation

- This command does NOT create a separate cleanup rule
- Reuses existing lifecycle scan logic
- Can trigger cleanup scan without process restart

---

## 7. File Sending to Feishu

### Implementation

- `/send <absolute path>` directly calls Feishu upload API
- Does NOT go through AI, zero latency
- Images (`.png/.jpg/.gif/.webp`, etc.) use image channel (limit 10MB)
- Other files use file channel (limit 30MB)
- Consistent with Feishu official limits

### Security Policy

| Policy | Description |
|--------|-------------|
| Sensitive file blacklist | Blocks `.env`, `id_rsa`, `.pem`, etc. |
| Directory whitelist | Only allows sending files within `ALLOWED_DIRECTORIES` |
| Default behavior | When `ALLOWED_DIRECTORIES` is not configured, `/send` is rejected by default |

---

## 8. Directory Policy (DirectoryPolicy)

### Validation Pipeline

All session creation entry points go through `DirectoryPolicy.resolve()` 9-stage validation:

| Stage | Check |
|-------|-------|
| 1 | **Priority Merge**: Merge directory candidates from all sources |
| 2 | **Format Check**: Check path format and length |
| 3 | **Normalization**: Standardize separators, remove redundant parts |
| 4 | **Danger Block**: Reject sensitive paths like `/etc`, `/root` |
| 5 | **Whitelist Check**: Validate against `ALLOWED_DIRECTORIES` |
| 6 | **Existence Pre-check**: Check if directory exists |
| 7 | **realpath Resolution**: Resolve symbolic links to real paths |
| 8 | **Git Root Normalization**: Normalize to Git repository root |
| 9 | **Post-normalization Check**: Re-validate whitelist after normalization |

### Directory Priority

| Priority | Source |
|----------|--------|
| 1 | Explicit input directory (command parameter) |
| 2 | Project alias (`PROJECT_ALIASES`) |
| 3 | Group default directory (session binding storage) |
| 4 | Global default directory (`DEFAULT_WORK_DIRECTORY`) |
| 5 | OpenCode server default directory |

### Security Defaults

- When `ALLOWED_DIRECTORIES` is not configured, users cannot customize paths via `/session new <path>`
- Error messages are sanitized; full paths only appear in server logs

---

## 9. Related Documentation

- [Workspace Guide](workspace-guide-en.md) - Working directory strategy
- [Configuration Center](environment-en.md) - Directory-related configuration
- [Commands Reference](commands-en.md) - File sending commands
