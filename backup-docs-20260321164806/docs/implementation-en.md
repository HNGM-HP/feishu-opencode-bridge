# Implementation Details

## 1) Permission Request Response

- In `permission.asked`, `tool` may not be a string tool name; actual whitelist matching may fall on the `permission` field.
- The response interface requires `response` to be `once | always | reject`, not `allow | deny`.

## 2) Question Tool Interaction

- Questions are rendered as Feishu cards; answers are parsed from user text replies.
- After parsing, responses are sent back as `answers: string[][]` required by OpenCode and included in undo history.

## 3) Streaming and Thinking Cards

- Text and thinking are written to output buffer separately; card mode switches automatically when thinking content appears.
- Cards support expand/collapse for thinking; final state retains completion status.

## 4) `/undo` Consistency

- Requires deleting Feishu-side message and executing `revert` on OpenCode simultaneously.
- Q&A scenarios may involve multiple associated messages; uses recursive rollback as fallback.

## 5) Private Chat Group Creation Card Interaction

- Dropdown selection action only records session selection, does not depend on card redraw; behavior consistent with `/panel` dropdown interaction.
- Group creation and binding are executed only when clicking "Create Group", avoiding misbinding due to card state synchronization.

## 6) `/clear free session` Behavior

- This command does not create a separate cleanup rule; instead reuses lifecycle scan logic.
- Allows manual triggering of a fallback scan with same rules as "startup cleanup" without restarting the process.

## 7) File Sending to Feishu

- `/send <absolute path>` directly calls Feishu upload API, does not go through AI, zero latency.
- Images (.png/.jpg/.gif/.webp etc.) use image channel (10MB limit); others use file channel (30MB limit), consistent with Feishu official limits.
- Built-in sensitive file blacklist (.env, id_rsa, .pem etc.) prevents accidental sending.
- **Security Policy**: Only allows sending files located within `ALLOWED_DIRECTORIES` whitelist range; when `ALLOWED_DIRECTORIES` is unconfigured, `/send` defaults to rejection.

## 8) Working Directory Strategy (DirectoryPolicy)

- All session creation entries uniformly go through `DirectoryPolicy.resolve()` 9-stage validation pipeline.
- Validation order: priority merge → format validation → path normalization → dangerous path interception → whitelist validation → existence pre-check → realpath resolution → Git root normalization → post-normalization re-check.
- Secure default: When `ALLOWED_DIRECTORIES` is unconfigured, users cannot customize paths.
- Error message desensitization: Users only see generic prompts; full paths are written to server logs only.
- Directory priority: Explicit specification > project aliases > group default > global default > OpenCode server default.
