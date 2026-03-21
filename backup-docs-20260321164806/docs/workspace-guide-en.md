# Working Directory and Project Strategy Guide (v2.9.3-beta)

This document describes the current working directory strategy, command entry points, and security constraints for the bridge service.

## 1. Design Goals

- Allow users to securely select working directories from the chat interface without breaking host boundaries.
- Maintain consistent behavior between Feishu and Discord: configurable directories, inheritable sessions, traceable permissions.
- Avoid "task stuck after directory switch" instance mismatch issues.

## 2. Directory Priority

When creating or switching sessions, directory sources are resolved in the following priority:

1. Explicit input directory (command argument / card input)
2. Project aliases (`PROJECT_ALIASES`)
3. Group default directory (session-bound storage)
4. Global default directory (`DEFAULT_WORK_DIRECTORY`)
5. OpenCode server default directory

Implementation: `src/utils/directory-policy.ts`.

## 3. Security Rules

Directory decisions go through a complete validation pipeline:

- Path format and length checks
- Dangerous path interception
- Whitelist checks (`ALLOWED_DIRECTORIES`)
- Existence and accessibility checks
- realpath resolution and secondary whitelist checks
- Git root directory normalization and re-checks

Failure at any check returns a user-friendly prompt and logs the detailed reason in server logs.

## 4. /create_chat Directory Sources (Current Behavior)

The "Work Project (Optional)" field in Feishu private chat `create_chat` panel combines three sources:

- `DEFAULT_WORK_DIRECTORY`
- `ALLOWED_DIRECTORIES`
- Existing session directories (historical sessions and bound sessions)

Plus `PROJECT_ALIASES` alias results.

Even without historical projects, the dropdown retains a "Follow Default Project" option to prevent the interaction entry point from disappearing.

## 5. Platform Command Entry Points

### 5.1 Feishu

- `/project list`
- `/project default`
- `/project default set <path|alias>`
- `/project default clear`
- `/session new <path|alias>`
- `/create_chat` (card-based session and directory selection)

### 5.2 Discord

- `///workdir`
- `///workdir <path|alias>`
- `///workdir clear`
- `///new [name] [--dir path|alias]`
- `///new-channel [name] [--dir path|alias]`
- `///create_chat`

## 6. Environment Variable Recommendations

Minimum recommended configuration:

```env
ALLOWED_DIRECTORIES=/path/to/projects,/path/to/repos
DEFAULT_WORK_DIRECTORY=/path/to/projects/default
PROJECT_ALIASES={"bridge":"/path/to/feishu-opencode-bridge"}
GIT_ROOT_NORMALIZATION=true
```

Notes:

- Without `ALLOWED_DIRECTORIES` configured, user custom directory capabilities are limited by default.
- `PROJECT_ALIASES` should only contain commonly used projects to avoid overwhelming the panel with options.

## 7. Permission and Directory Consistency

Permission responses no longer rely solely on `sessionId`, but also include directory candidates:

- Priority: current session directory (`resolvedDirectory/defaultDirectory`)
- Then try known directory list
- Finally fall back to default directory instance

This reduces permission confirmation deadlocks after directory switches.

## 8. Common Questions

### Q1: Why does it say "not allowed" even after setting a directory?

- Check if it's within `ALLOWED_DIRECTORIES` range.
- Check if it's still within the whitelist after realpath resolution (common in symlink scenarios).

### Q2: Why can't I see historical projects in /create_chat?

- Directory may be filtered by whitelist.
- Directory may not exist or lack read permissions and was automatically excluded.

### Q3: After switching directory, permission seems "allowed" but task didn't continue?

- Check if permission response hit directory candidates in logs.
- Confirm OpenCode instance and current session directory are consistent.

## 9. Maintenance Recommendations

- Directory-related changes must include tests (directory policy + panel options + permission response).
- Before release, at least run `npm run build` and `npm test`.
- When directory strategy changes, update `.env.example` and README environment variables section accordingly.
